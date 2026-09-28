// Container-side probe: does the sidebar HOST service exist in this composition?

/** The cordis plugin name this probe registers under inside the booted profile. */
export const name: string = "mpd-ui-sidebar-probe"

/** One composed loader row as this probe reads it. */
interface LoaderEntry {
  /** The row's options: the configured id and the plugin name it resolves to. */
  options?: { id?: string; name?: string }
}

/** The ctx handed to `apply`, narrowed to the seams this probe reads. */
interface ProbeContext {
  /**
   * Service lookup, with the harness's own strict flag (the probe passes `false`). Declared REQUIRED
   * on purpose: the probe calls it unguarded inside its own try/catch, so a missing seam must still
   * throw into that catch exactly as before.
   */
  get: (name: string, strict?: boolean) => unknown
  /**
   * The loader, where the composed rows — and therefore the sidebar host row — are visible.
   * Declared REQUIRED for the same reason as `get`: the call is guarded by try/catch, not by `?.`.
   */
  loader: { entries: () => Iterable<LoaderEntry> }
}

/**
 * The probe entry point: report which sidebar-host service names answer in this composition, and
 * which composed rows look like a sidebar row.
 *
 * @param ctx - The booted profile's ctx (only the seams declared on `ProbeContext` are read).
 */
export function apply(ctx: ProbeContext): void {
  /** The candidate service names the sidebar host has shipped under, in probe order. */
  const names: readonly string[] = ["betterSidebar", "sidebar", "webSidebar"]
  /** The candidates that answer a lookup in this composition (an unknown name throws, and is a miss). */
  const found = names.filter((n) => { try { return ctx.get(n, false) !== undefined } catch { return false } })
  /** The composed rows as `<id>:<name>` strings; empty when there is no loader to ask. */
  let entries: string[] = []
  try { entries = [...ctx.loader.entries()].map((e) => String(e.options?.id) + ":" + String(e.options?.name).slice(0, 60)) } catch { /* no loader */ }
  console.log("[ui-probe] sidebarServices=" + (found.length ? found.join(",") : "NONE") +
    " | betterSidebarEntry=" + (entries.filter((e) => /sidebar/i.test(e)).join(" ") || "none"))
  setTimeout(() => process.exit(0), 400)
}
