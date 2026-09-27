// Design §10.1 ownership proof (captain's ruling 2): `mpd-config-plugin` owns the namespace
// registration and the TUI package is a PURE CONSUMER whose registration is a guarded FALLBACK.
//
// The settings double below models the HOST'S OWN GUARD — `register()` throws
// `settings namespace "<ns>" is already registered` (`dsh-settings/lib/index.js:283`) — so a
// collision cannot pass silently here: if both plugins registered, the second call throws and the
// registration count would be 2 or the apply would fail.
import { describe, expect, test } from "bun:test"
import { apply as applyTui } from "../src/index"
import { apply as applyConfig } from "../../mpd-config-plugin/src/index"

/** A settings provider double with the host's duplicate guard and the reads a probe needs. */
function settingsDouble() {
  const registrations: Array<{ ns: string; options?: any }> = []
  let section: any = undefined
  const host = {
    register(ns: string, _schema: unknown, options?: any) {
      if (registrations.some((entry) => entry.ns === ns)) throw new Error(`settings namespace "${ns}" is already registered`)
      registrations.push({ ns, options })
      return { get: () => section, watch: () => () => {}, update: async () => {}, replace: async () => {} }
    },
    describe: () => registrations.map((entry) => ({ ns: entry.ns, value: section, user: section, base: entry.options?.base, revision: 0, applies: entry.options?.applies })),
    get: (ns: string) => (registrations.some((entry) => entry.ns === ns) ? section : undefined),
  }
  return { host, registrations, setSection: (next: any) => { section = next } }
}

/** A ctx whose injected services are fixed, with the two seams each package needs. */
function contextFor(services: Record<string, unknown>) {
  const warnings: string[] = []
  const infos: string[] = []
  const cleanups: Array<() => void> = []
  const build = (): Record<string, any> => ({
    // A real cordis context exposes mounted services through `get`; the measured "inject-free probe
    // sees nothing" behaviour is modelled by the SCOPED object only for services a fiber did not
    // declare, which is not what this test is about.
    get: (name: string) => services[name],
    inject: (deps: readonly string[], callback: (scoped: Record<string, any>) => void) => {
      const scoped: Record<string, any> = { get: (name: string) => services[name], ...services }
      if (deps.every((dep) => services[dep] !== undefined || dep === "mpdDsh")) callback(scoped)
      return {}
    },
    effect: (callback: () => any) => {
      const cleanup = callback()
      if (typeof cleanup === "function") cleanups.push(cleanup)
      return {}
    },
    provide: () => {},
    logger: { warn: (message: string) => warnings.push(String(message)), info: (message: string) => infos.push(String(message)), debug: () => {} },
  })
  return { ctx: build(), warnings, infos, cleanups }
}

describe("exactly ONE successful registration per composition (design §10.1)", () => {
  test("mpd-config present: it registers, the TUI skips its fallback and says so", () => {
    const settings = settingsDouble()
    // the config plugin needs the adapter seam surface too
    const configCtx = contextFor({
      settings: settings.host,
      mpdDsh: {
        tools: { register: () => () => {}, guard: () => () => {} },
        settingsReader: () => undefined,
        onSettingsDocumentUpdated: () => () => {},
        settingsMutate: async () => ({ ok: true }),
        settingsRegister: (ns: string, schema: unknown, options?: any) => {
          try {
            settings.host.register(ns, schema, options)
            return { ok: true }
          } catch (error) {
            return { ok: false, error: String((error as Error)?.message ?? error) }
          }
        },
        registerTool: () => () => {},
        workspaceRoot: () => "/ws",
        workspaceRootsAll: () => [],
      },
    })
    applyConfig(configCtx.ctx as never)

    const tuiCtx = contextFor({ settings: settings.host, tuiSettingsSections: { register: () => () => {} } })
    applyTui(tuiCtx.ctx as never)

    expect(settings.registrations).toHaveLength(1)
    expect(settings.registrations[0].ns).toBe("mpd")
    // the TUI's skipped fallback is REPORTED, not silent
    expect(tuiCtx.infos.some((line) => line.includes("already served"))).toBe(true)
    expect(tuiCtx.warnings).toEqual([])
  })

  test("mpd-config present but its registration still pending: the fallback still yields (deterministic owner check)", () => {
    const settings = settingsDouble()
    // the config plugin's service exists, the namespace is NOT served yet: the fallback must wait
    // for the owner instead of racing it (that race was measured in a real boot)
    const tuiCtx = contextFor({ settings: settings.host, tuiSettingsSections: { register: () => () => {} }, mpdConfig: { get: () => ({}), states: () => ({}) } })
    applyTui(tuiCtx.ctx as never)
    expect(settings.registrations).toEqual([])
    expect(tuiCtx.infos.some((line) => line.includes("mpd-config owns the registration"))).toBe(true)
  })

  test("mpd-config absent: the TUI's fallback registers the namespace (the composition still works)", () => {
    const settings = settingsDouble()
    const tuiCtx = contextFor({ settings: settings.host, tuiSettingsSections: { register: () => () => {} } })
    applyTui(tuiCtx.ctx as never)
    expect(settings.registrations).toHaveLength(1)
    expect(settings.registrations[0].ns).toBe("mpd")
    expect(settings.registrations[0].options?.applies).toBe("restart")
  })

  test("both plugins in ONE composition: still exactly one registration, whoever runs first", () => {
    // TUI FIRST — the reverse order must also be safe (the config plugin's registration then wins
    // nothing: it fails loud, reports it, and the TUI-owned namespace keeps serving).
    const settings = settingsDouble()
    const tuiCtx = contextFor({ settings: settings.host, tuiSettingsSections: { register: () => () => {} } })
    applyTui(tuiCtx.ctx as never)
    const configCtx = contextFor({
      settings: settings.host,
      mpdDsh: {
        tools: { register: () => () => {}, guard: () => () => {} },
        settingsReader: () => undefined,
        onSettingsDocumentUpdated: () => () => {},
        settingsMutate: async () => ({ ok: true }),
        settingsRegister: (ns: string, schema: unknown, options?: any) => {
          try {
            settings.host.register(ns, schema, options)
            return { ok: true }
          } catch (error) {
            return { ok: false, error: String((error as Error)?.message ?? error) }
          }
        },
        registerTool: () => () => {},
        workspaceRoot: () => "/ws",
        workspaceRootsAll: () => [],
      },
    })
    applyConfig(configCtx.ctx as never)
    expect(settings.registrations).toHaveLength(1)
    // The sentence this arm used to pin described a handover to the TUI fallback. No harness
    // composes a namespace registry any more (measured 2026-09-27), so what the refusal must say is
    // where the values come from instead: this row's own Config, under the entry id.
    expect(configCtx.warnings.some((line) => line.includes("namespace-registry model is RETIRED"))).toBe(true)
    expect(configCtx.warnings.some((line) => line.includes('entry "mpd-config"'))).toBe(true)
  })
})
