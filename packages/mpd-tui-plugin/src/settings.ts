// Seam 6 — `ctx.tuiSettingsSections`: the `/settings` section of the mpd bundle.
//
// DISCLOSURE (read before trusting the writes): the fields below are the real
// `.mpd/mpd.jsonc` knobs — the runtime config layer the mpd plugins read through
// `packages/mpd-config-plugin`. That layer is NOT the harness settings document
// this screen writes to: the section declares and edits those knobs under the
// harness settings namespace `mpd`, and the two are BRIDGED (t35): `mpd-config`
// observes the namespace through the adapter's settings seam and rewrites the value
// into `<workspace>/.mpd/mpd.jsonc` with comments and key order preserved. The
// settings value is visible to the config layer immediately, while a RUNNING
// session's plugin behaviour changes only after a restart — every knob in this
// section is captured at plugin mount (design §D.1).
//
// T-18 HOST LIMITATION (the honest half, also rendered by the Web card as its second
// disclosure paragraph and exported as `BRIDGE_RESTART_LIMIT` from the shared schema):
// the FILE-derived base is read once at plugin mount and stays fixed for the process
// lifetime, so a hand edit of `.mpd/mpd.jsonc` applies at the next dsh boot and never
// mid-process. Only a change made through the settings document can reach a RUNNING
// plugin, and only where the plugin subscribes to the host's settings-document update
// (the watchdog engine does, `engine.ts` `onSettingsDocumentUpdated`); this change does
// not prove that seam is exposed on the installed host, so no surface claims a live
// reload — the per-field hints state the restart truth, and `BRIDGE_RESTART_LIMIT` carries
// the limitation on the Web card (this pane keeps its one-line hints free of it so the
// restart disclosure and the "never lost" clause stay legible).
//
// The disclosure is not only in this header and the READMEs — it is carried by
// the RENDERED METADATA too (t21): every field hint names its mpd.jsonc key and
// then states the marker, so a user reading `/settings` learns it at the point of
// use. The marker is a single exported constant and the hints are built by one
// helper, so it cannot be dropped from a field silently (test/plugin.test.ts
// asserts it on the registered section).
//
// The namespace registration exists so the screen treats the section as
// available (an unregistered namespace is rendered as unavailable by design).
// `z` comes from the bundle's already-vendored schemastery copy. Same directory
// specifier rule as `index.ts`.
import type { PluginContextLike, SeamOutcome, SettingsProviderLike, TuiSettingsSectionLike, TuiSettingsSectionsLike } from "./types.js"
// ONE source for the namespace schema, the thirteen knobs and the disclosure: `mpd-config-plugin`
// owns the namespace (design §10.1) and exports them; this package consumes them for its
// guarded FALLBACK registration and for the section it declares.
import { BRIDGE_DISCLOSURE, BRIDGE_NOT_LOST, SettingsSchema, SETTINGS_KNOBS, SETTINGS_NS } from "../../mpd-config-plugin/src/settings-schema"
import type { Log } from "./log.js"
import { onService } from "./host.js"

export { SETTINGS_NS }

/** Re-exported so this package's tests and consumers keep one name for the schema. */
export { SettingsSchema }

/**
 * The disclosure a user must be able to read ON SCREEN (t21, reworded by t35).
 *
 * Every hint that names an `.mpd/mpd.jsonc` key carries this sentence, because the
 * screen is the only place a user learns what saving a field does. It has TWO parts
 * and both are load-bearing: the save IS written to the workspace file for the live
 * session workspace(s), and the BEHAVIOUR change still needs a restart because the
 * knobs are read at plugin mount. The old "not bridged" claim was true before t35 and
 * is now deleted, not softened — a hint that kept it would be a lie.
 */
export { BRIDGE_DISCLOSURE }
export { BRIDGE_NOT_LOST }

/**
 * The runtime notice the surfaces show when the save had no live session workspace to
 * write to (design §D.2 "no live root at save time"). Exported so the same sentence is
 * used by every surface that reports a save outcome.
 */
export const BRIDGE_NO_WORKSPACE_NOTICE = "saved to settings — not yet written to any .mpd/mpd.jsonc (no live session)"

/**
 * One field hint: the real mpd.jsonc key PLUS both on-screen statements — the bridge+restart
 * truth AND the clause that keeps a settings-only save from reading as a lost one (captain's
 * ruling 1: with 0 or N live roots the value persists in the host settings document and the
 * read-in layer applies it to every workspace immediately).
 */
function knobHint(key: string): string {
  return `mpd.jsonc ${key} — ${BRIDGE_DISCLOSURE} ${BRIDGE_NOT_LOST}`
}

/**
 * Is the namespace already served? Probed through the provider's own read surface: `describe()`
 * is the documented way to enumerate served namespaces, with `get()` as the fallback for a
 * provider that answers only reads.
 */
function isServed(provider: SettingsProviderLike): boolean {
  try {
    if (typeof provider.describe === "function") {
      const described = provider.describe()
      if (Array.isArray(described) && described.some((entry) => String((entry as { ns?: unknown })?.ns ?? "") === SETTINGS_NS)) return true
    }
  } catch {
    /* an unreadable describe must not be read as "unserved" by itself */
  }
  try {
    return typeof provider.get === "function" && provider.get(SETTINGS_NS) !== undefined
  } catch {
    return false
  }
}

/** Is the config plugin in this composition? Its `mpdConfig` service is the signal (design §10.1). */
function configPluginPresent(ctx: PluginContextLike): boolean {
  try {
    return typeof ctx.get === "function" && ctx.get("mpdConfig") !== undefined
  } catch {
    return false
  }
}

/** The fields the section renders, built from the ONE shared knob list plus the shared disclosure. */
export const SETTINGS_FIELDS: readonly TuiSettingsSectionLike["fields"][number][] = SETTINGS_KNOBS.map((knob) => ({
  path: [...knob.path],
  label: knob.label,
  descriptions: { zh: knob.zh },
  hint: knobHint(knob.path.join(".")),
  kind: knob.kind,
  ...(knob.options === undefined ? {} : { options: knob.options.map((value) => ({ value, label: value })) }),
}))

/**
 * The section this plugin declares.
 *
 * Every `hint` is built by {@link knobHint} and therefore carries
 * {@link BRIDGE_DISCLOSURE}: the user reading `/settings` learns at the point of
 * use that an edit here is written to the workspace file AND that its behaviour
 * change waits for a restart.
 */
export const SETTINGS_SECTION: TuiSettingsSectionLike = {
  ns: SETTINGS_NS,
  title: "MPD bundle",
  descriptions: { zh: "MPD 插件包" },
  fields: SETTINGS_FIELDS,
}

/**
 * Activate the settings namespace and the `/settings` section.
 * @param ctx - the plugin context.
 * @param log - diagnostics.
 * @returns the seam handle; the section outcome carries the namespace result too.
 */
export function registerSettingsSection(ctx: PluginContextLike, log: Log): { outcome(): SeamOutcome } {
  let namespace: SeamOutcome = { state: "absent", detail: "settings was not injected" }
  let section: SeamOutcome = { state: "absent", detail: "tuiSettingsSections was not injected" }

  // 1) Namespace: a GUARDED FALLBACK (design §10.1). `mpd-config-plugin` owns the registration,
  //    because only it can serve the file-derived `base`. This package registers ONLY when the
  //    namespace is genuinely unserved — duplicate registration fails loud on this host
  //    (`dsh-settings` `register()` throws `settings namespace "<ns>" is already registered`), so
  //    the probe below is the guard that keeps the two owners from colliding.
  onService(ctx, "settings", (_scoped, service) => {
    const provider = service as SettingsProviderLike
    if (typeof provider?.register !== "function") {
      namespace = { state: "refused", detail: "settings.register is missing" }
      return
    }
    // DETERMINISTIC owner check first: `mpd-config` provides the `mpdConfig` service, and a service
    // is visible to `ctx.get` once its provider's fiber is active. This row mounts AFTER the config
    // plugin, so its presence means the owner IS in this composition and will register the moment
    // the settings provider is up — the fallback must not race it (MEASURED in a real boot: both
    // plugins parked on `ctx.inject(["settings"])` and the fallback won, leaving the namespace with
    // no file-derived base).
    if (configPluginPresent(ctx)) {
      namespace = { state: "absent", detail: `namespace ${SETTINGS_NS} is owned by mpd-config in this composition — the fallback registration was skipped` }
      log.info(`settings namespace ${SETTINGS_NS}: mpd-config owns the registration — fallback skipped (design §10.1)`)
      return
    }
    if (isServed(provider)) {
      namespace = { state: "absent", detail: `namespace ${SETTINGS_NS} is already served by mpd-config — the fallback registration was skipped` }
      log.info(`settings namespace ${SETTINGS_NS} is already served — fallback registration skipped (design §10.1)`)
      return
    }
    try {
      provider.register(SETTINGS_NS, SettingsSchema, { applies: "restart" })
      namespace = { state: "requested", detail: `namespace ${SETTINGS_NS} requested by the fallback (no other registrant) (no host read-back)` }
    } catch (error) {
      namespace = { state: "refused", detail: String((error as Error)?.message ?? error) }
      log.warn(`settings namespace ${SETTINGS_NS} not registered: ${namespace.detail ?? ""}`)
    }
  })

  // 2) Section: display metadata only (the TUI owns rendering and saving).
  onService(ctx, "tuiSettingsSections", (_scoped, service) => {
    const sections = service as TuiSettingsSectionsLike
    if (typeof sections?.register !== "function") {
      section = { state: "refused", detail: "tuiSettingsSections.register is missing" }
      return
    }
    try {
      sections.register(SETTINGS_SECTION)
      section = { state: "requested", detail: `section ${SETTINGS_NS} requested (no host read-back)` }
    } catch (error) {
      section = { state: "refused", detail: String((error as Error)?.message ?? error) }
      log.warn(`/settings section refused: ${section.detail ?? ""}`)
    }
  })

  return {
    outcome: () => ({
      state: section.state,
      detail: `${section.detail ?? ""} · namespace ${SETTINGS_NS}: ${namespace.state}${namespace.detail === undefined ? "" : ` (${namespace.detail})`}`,
    }),
  }
}
