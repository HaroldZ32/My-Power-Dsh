// Seam 6 — `ctx.tuiSettingsSections`: the `/settings` section of the mpd bundle.
//
// DISCLOSURE (read before trusting the writes): the fields below are the real
// `.mpd/mpd.jsonc` knobs — the runtime config layer the mpd plugins read through
// `packages/mpd-config-plugin`. That layer is NOT the harness settings document
// this screen writes to: the section declares and edits those knobs under the
// harness settings namespace `mpd`, and the two are NOT bridged. A saved edit
// therefore persists in the harness settings document; it does not rewrite
// `.mpd/mpd.jsonc`. The bridge is a NAMED follow-up (`mpd-settings-bridge`) and is
// NOT claimed here (README §"What is not claimed").
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
import z from "../../mpd-agent-teams-plugin/_deps/schemastery"
import type { PluginContextLike, SeamOutcome, SettingsProviderLike, TuiSettingsSectionLike, TuiSettingsSectionsLike } from "./types.js"
import type { Log } from "./log.js"
import { onService } from "./host.js"

/** The settings namespace the section edits. */
export const SETTINGS_NS = "mpd"

/** The mpd.jsonc knob schema (mirrors packages/mpd-config-plugin's consumed keys). */
export const SettingsSchema = z.object({
  hashline: z.object({ maxDiffChars: z.number().default(20000) }),
  commentChecker: z.object({ autoCheck: z.boolean().default(true) }),
  ulw: z.object({ maxRounds: z.number().default(6) }),
  memory: z.object({ vcs: z.union([z.const("git"), z.const("svn")]).default("git") }),
  team: z.object({ stateDir: z.string().default(".mpd/team") }),
  boulder: z.object({ dir: z.string().default(".mpd") }),
})

/**
 * The disclosure a user must be able to read ON SCREEN (t21).
 *
 * Every hint that names an `.mpd/mpd.jsonc` key carries this marker, because the
 * screen is the only place a user learns what saving a field does: the section
 * writes the harness settings document, NOT the mpd.jsonc layer, and the bridge
 * between them is a named follow-up (`mpd-settings-bridge`) rather than shipped
 * behaviour.
 */
export const UNBRIDGED_MARKER = "not bridged: a save here does not rewrite .mpd/mpd.jsonc"

/** One field hint: the real mpd.jsonc key PLUS the on-screen disclosure. */
function knobHint(key: string): string {
  return `mpd.jsonc ${key} — ${UNBRIDGED_MARKER}`
}

/** The fields the section renders (path vocabulary = the settings document paths). */
export const SETTINGS_FIELDS: readonly TuiSettingsSectionLike["fields"][number][] = [
  {
    path: ["hashline", "maxDiffChars"],
    label: "Inline diff limit",
    descriptions: { zh: "行内 diff 上限" },
    hint: knobHint("hashline.maxDiffChars"),
    kind: "number",
  },
  {
    path: ["commentChecker", "autoCheck"],
    label: "Comment checker",
    descriptions: { zh: "注释检查" },
    hint: knobHint("commentChecker.autoCheck"),
    kind: "boolean",
  },
  {
    path: ["ulw", "maxRounds"],
    label: "Ultrawork rounds",
    descriptions: { zh: "Ultrawork 轮数" },
    hint: knobHint("ulw.maxRounds"),
    kind: "number",
  },
  {
    path: ["memory", "vcs"],
    label: "Memory backend",
    descriptions: { zh: "记忆后端" },
    hint: knobHint("memory.vcs"),
    kind: "select",
    options: [
      { value: "git", label: "git" },
      { value: "svn", label: "svn" },
    ],
  },
  {
    path: ["team", "stateDir"],
    label: "Team state directory",
    descriptions: { zh: "团队状态目录" },
    hint: knobHint("team.stateDir"),
    kind: "text",
  },
  {
    path: ["boulder", "dir"],
    label: "Boulder directory",
    descriptions: { zh: "Boulder 目录" },
    hint: knobHint("boulder.dir"),
    kind: "text",
  },
]

/**
 * The section this plugin declares.
 *
 * Every `hint` is built by {@link knobHint} and therefore carries
 * {@link UNBRIDGED_MARKER}: the user reading `/settings` learns at the point of
 * use that an edit here does not rewrite `.mpd/mpd.jsonc`.
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

  // 1) Namespace: makes the section live rather than "unavailable". A failure (a
  //    duplicate namespace, a schema the provider rejects) is contained and
  //    reported; the section is still declared.
  onService(ctx, "settings", (_scoped, service) => {
    const provider = service as SettingsProviderLike
    if (typeof provider?.register !== "function") {
      namespace = { state: "refused", detail: "settings.register is missing" }
      return
    }
    try {
      provider.register(SETTINGS_NS, SettingsSchema, { applies: "restart" })
      namespace = { state: "requested", detail: `namespace ${SETTINGS_NS} requested (no host read-back)` }
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
