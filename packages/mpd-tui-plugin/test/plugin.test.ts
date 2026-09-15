// Plugin-contract, seam-activation and honesty tests for packages/mpd-tui-plugin.
//
// The fakes MODEL THE HOST instead of being permissive:
//   * a service is NOT reachable through `ctx.get` — that is the measured
//     inject-free invisibility (T4-INERT-1) that made the first version of this
//     package register nothing in a real boot;
//   * `ctx.inject([id], cb)` runs `cb` exactly when the service is composed, and
//     the injected scope resolves it (measured in the same harness);
//   * refusals return NO-OP disposers (renderers/shortcuts) exactly like the host,
//     so a test can prove the plugin does not mistake one for a registration.
import { describe, expect, test } from "bun:test"
import * as mod from "../src/index"
import { TRANSCRIPT_TYPES } from "../src/renderers"
import { BRIDGE_DISCLOSURE, BRIDGE_NO_WORKSPACE_NOTICE, BRIDGE_NOT_LOST, SETTINGS_FIELDS } from "../src/settings"
import { AMBIGUOUS_MULTI_ROOT_NOTICE, NO_LIVE_SESSION_NOTICE, readBoardState, statusLine } from "../src/state"
import { SHORTCUT_BINDINGS } from "../src/shortcuts"
import { STATUS_KEY } from "../src/status"
import { DECISION_EVENTS } from "../src/decisions"

type Disposer = () => void | undefined

interface Double {
  ctx: Record<string, any>
  probes: string[]
  injections: string[][]
  cleanups: Disposer[]
  warnings: string[]
  infos: string[]
  debugs: string[]
  services: Record<string, any>
}

interface DoubleOptions {
  /** Model an older/plain ctx with no `inject` at all (the inject-free case). */
  injectSupported?: boolean
  grants?: (permission: string, scope: string) => boolean
}

function hostDouble(services: Record<string, any> = {}, options: DoubleOptions = {}): Double {
  const probes: string[] = []
  const injections: string[][] = []
  const cleanups: Disposer[] = []
  const warnings: string[] = []
  const infos: string[] = []
  const debugs: string[] = []

  const build = (): Record<string, any> => {
    const ctx: Record<string, any> = {
      // Inject-free visibility: the service is NOT reachable here.
      get(name: string, strict?: boolean) {
        probes.push(name)
        void strict
        return undefined
      },
      effect(callback: () => Disposer) {
        const cleanup = callback()
        if (typeof cleanup === "function") cleanups.push(cleanup)
        return {}
      },
      logger: {
        info: (message: string) => infos.push(message),
        warn: (message: string) => warnings.push(message),
        debug: (message: string) => debugs.push(message),
      },
    }
    if (options.injectSupported !== false) {
      ctx.inject = (dependencies: readonly string[], callback: (scoped: Record<string, any>) => void) => {
        injections.push([...dependencies])
        const scoped = build()
        // Inside an injected scope the service IS reachable (measured).
        scoped.get = (name: string) => services[name]
        const ready = dependencies.every((id) => services[id] !== undefined)
        if (ready) callback(scoped)
        return {}
      }
    }
    return ctx
  }

  return { ctx: build(), probes, injections, cleanups, warnings, infos, debugs, services }
}

/** A recording double for every service this row touches. */
function allServices(overrides: Record<string, any> = {}): {
  services: Record<string, any>
  calls: Record<string, any[]>
  disposed: { count: number }
  decisionDisposerCalls: { count: number }
} {
  const calls: Record<string, any[]> = {
    statusSet: [],
    renderers: [],
    sections: [],
    scenes: [],
    shortcuts: [],
    maps: [],
    namespaces: [],
    commands: [],
    decisions: [],
  }
  const disposed = { count: 0 }
  const decisionDisposerCalls = { count: 0 }
  const disposer = (): void => {
    disposed.count += 1
  }
  const services: Record<string, any> = {
    // The config layer's own surface: the status line reads the LAST settings-bridge outcome
    // from it (§D.2 row 2). Overridable per test through `overrides`.
    mpdConfig: { states: () => ({ files: [], errors: [], writeback: null }) },
    tuiStatus: {
      set(key: string, text: unknown) {
        calls.statusSet.push({ key, text })
        return disposer
      },
    },
    tuiRenderers: {
      register(type: string, renderer: unknown) {
        calls.renderers.push({ type, renderer })
        return disposer
      },
    },
    tuiSettingsSections: {
      register(section: unknown) {
        calls.sections.push(section)
        return disposer
      },
    },
    tuiScenes: {
      register(descriptor: unknown) {
        calls.scenes.push(descriptor)
        return disposer
      },
      open(id: string) {
        calls.scenes.push({ open: id })
        return true
      },
    },
    tuiShortcuts: (() => {
      const owned: { combo: string; description: string }[] = []
      return {
        register(combo: string, definition: { description: string }) {
          calls.shortcuts.push({ combo, description: definition?.description })
          owned.push({ combo, description: definition?.description })
          return disposer
        },
        list() {
          return owned
        },
      }
    })(),
    tuiCommandTrees: {
      register(provider: unknown) {
        calls.maps.push(provider)
        return disposer
      },
    },
    tuiDialogs: {
      async select() {
        return undefined
      },
      async confirm() {
        return undefined
      },
      async input() {
        return undefined
      },
    },
    settings: {
      register(ns: string, schema: unknown, options: unknown) {
        calls.namespaces.push({ ns, schema, options })
        return {}
      },
    },
    commands: {
      register(definition: unknown) {
        calls.commands.push(definition)
        return disposer
      },
    },
    tuiPluginHost: {
      grants: { allows: () => false },
      subscribeDecision(_ctx: unknown, event: string) {
        calls.decisions.push(event)
        // The measured production behaviour: the identity assertion throws
        // before any policy question, because admission is unreachable.
        throw new Error("dsh-tui: Component identity is not verified for this activation")
      },
    },
  }
  Object.assign(services, overrides)
  void decisionDisposerCalls
  return { services, calls, disposed, decisionDisposerCalls }
}

function outcomeOf(report: mod.ApplyReport, id: string): { state: string; detail?: string } {
  const found = report.outcomes.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`no outcome recorded for ${id}`)
  return found.outcome
}

describe("plugin contract", () => {
  test("exports name / Config (type + schema) / apply and NO default export", () => {
    expect(mod.name).toBe("mpd-tui")
    expect(typeof mod.apply).toBe("function")
    expect(typeof mod.Config).toBe("function")
    expect((mod as Record<string, unknown>).default).toBeUndefined()
  })

  test("every config key has a default in the schema", () => {
    expect(mod.Config({})).toEqual({
      statusLine: true,
      statusIntervalMs: 3000,
      renderers: true,
      settingsSection: true,
      scene: true,
      commandTrees: true,
      commands: true,
      shortcuts: true,
      dialogs: true,
      sessionEvents: true,
      decisionEvents: true,
      logPrefix: "mpd-tui",
    })
  })

  test("the schema rejects a wrong type instead of silently dropping it", () => {
    expect(() => mod.Config({ statusIntervalMs: "soon" })).toThrow()
  })

  test("resolveConfig defaults every key and repairs an invalid interval", () => {
    expect(mod.resolveConfig({})).toEqual(mod.Config({}))
    expect(mod.resolveConfig({ statusIntervalMs: -1 }).statusIntervalMs).toBe(3000)
    expect(mod.resolveConfig({ statusIntervalMs: Number.NaN }).statusIntervalMs).toBe(3000)
    expect(mod.resolveConfig({ statusLine: false }).statusLine).toBe(false)
    expect(mod.resolveConfig({ logPrefix: "" }).logPrefix).toBe("mpd-tui")
  })
})

describe("T4-INERT-1: activation requires the inject form", () => {
  test("a ctx WITHOUT inject registers nothing, even when get() would answer", () => {
    const { services } = allServices()
    const host = hostDouble(services, { injectSupported: false })
    // Model the old failure: get() answering is exactly what the first version
    // relied on, and it is NOT how the host exposes a service.
    host.ctx.get = (name: string) => services[name]
    const report = mod.apply(host.ctx as never, {})
    expect(host.injections).toHaveLength(0)
    expect(outcomeOf(report, "tuiStatus").state).toBe("absent")
    expect(outcomeOf(report, "tuiScenes").state).toBe("absent")
    expect(host.warnings.some((line) => line.includes("no DSH-TUI service is composed"))).toBe(true)
  })

  test("with inject supported but no service composed, nothing is registered and nothing throws", () => {
    const host = hostDouble({})
    const report = mod.apply(host.ctx as never, {})
    expect(host.injections.length).toBeGreaterThan(0) // the attempts were made
    for (const entry of report.outcomes) expect(entry.outcome.state).toBe("absent")
    expect(host.cleanups).toHaveLength(0)
  })

  test("apply survives a throwing ctx.get and a ctx without effect()", () => {
    const host = hostDouble({})
    host.ctx.get = () => {
      throw new Error('cannot get property "commands" without inject')
    }
    delete host.ctx.effect
    expect(() => mod.apply(host.ctx as never, {})).not.toThrow()
  })
})

describe("full composition (every service injected)", () => {
  test("every seam activates through ctx.inject and reports an honest outcome", () => {
    const { services, calls } = allServices()
    const host = hostDouble(services)
    const report = mod.apply(host.ctx as never, { statusIntervalMs: 0 })

    // The activation channel is inject, per seam.
    const injected = host.injections.map((entry) => entry[0])
    for (const id of ["tuiStatus", "tuiRenderers", "tuiSettingsSections", "tuiScenes", "tuiCommandTrees", "tuiShortcuts", "tuiDialogs", "commands", "tuiPluginHost", "settings"]) {
      expect(injected).toContain(id)
    }

    // tuiStatus: one live keyed contribution under the conventions' key.
    expect(STATUS_KEY).toBe("mpd-tui")
    const published = calls.statusSet.filter((entry) => entry.key === STATUS_KEY)
    expect(published.length).toBeGreaterThan(0)
    expect(String(published[0].text).startsWith("mpd:")).toBe(true)
    expect(outcomeOf(report, "tuiStatus").state).toBe("requested")
    // No bridge outcome yet: the line carries the counts and NO notice.
    expect(String(published[0].text)).not.toContain("no live session")

    // tuiRenderers: one renderer per declared log-only type.
    expect(calls.renderers.map((entry) => entry.type)).toEqual([...TRANSCRIPT_TYPES])
    expect(outcomeOf(report, "tuiRenderers").state).toBe("requested")

    // tuiSettingsSections: the mpd.jsonc section, with the on-screen disclosure.
    expect(calls.sections).toHaveLength(1)
    expect(calls.sections[0].ns).toBe("mpd")
    expect(calls.sections[0].fields).toHaveLength(6)
    for (const field of calls.sections[0].fields) {
      expect(field.hint).toContain("mpd.jsonc")
      expect(field.hint).toContain(BRIDGE_DISCLOSURE)
      expect(field.hint).toContain(BRIDGE_NOT_LOST)
    }

    // tuiScenes: the board scene.
    expect(calls.scenes.filter((entry) => entry.id === "mpd-tui-board")).toHaveLength(1)

    // tuiShortcuts: registered AND confirmed through the host's list() read-back.
    expect(calls.shortcuts.map((entry) => entry.combo)).toEqual(SHORTCUT_BINDINGS.map((binding) => binding.combo))
    const shortcutsOutcome = outcomeOf(report, "tuiShortcuts")
    expect(shortcutsOutcome.state).toBe("confirmed")
    expect(shortcutsOutcome.detail).toContain("alt+m")

    // tuiCommandTrees + commands: the tree root matches the registered command.
    expect(calls.maps).toHaveLength(1)
    expect(calls.maps[0].root).toBe("mpd")
    expect(calls.maps[0].children(["mpd"]).map((node: { name: string }) => node.name)).toEqual(["board", "workmates", "status"])
    expect(calls.commands).toHaveLength(1)
    expect(calls.commands[0].name).toBe("mpd")

    // settings namespace + dialogs availability.
    expect(calls.namespaces.map((entry) => entry.ns)).toEqual(["mpd"])
    expect(outcomeOf(report, "tuiDialogs").state).toBe("available")

    // The aggregate line names every role with its measured state.
    const aggregate = host.infos.find((line) => line.includes("mpd TUI surfaces"))
    expect(aggregate).toBeString()
    expect(aggregate).toContain("tuiShortcuts(confirmed")
    expect(aggregate).toContain("tuiStatus(requested")
  })

  test("cleanup runs on the injected scope: status cleared, registrations released", () => {
    const { services, calls, disposed } = allServices()
    const host = hostDouble(services)
    mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    expect(host.cleanups.length).toBeGreaterThan(0)
    for (const cleanup of host.cleanups) cleanup()
    expect(disposed.count).toBeGreaterThan(0)
    expect(calls.statusSet.some((entry) => entry.text === undefined && entry.key === STATUS_KEY)).toBe(true)
  })

  test("each seam can be disabled by config, and disabling keeps apply inert", () => {
    const { services, calls } = allServices()
    const host = hostDouble(services)
    mod.apply(host.ctx as never, {
      statusLine: false,
      renderers: false,
      settingsSection: false,
      scene: false,
      commandTrees: false,
      commands: false,
      shortcuts: false,
      dialogs: false,
      decisionEvents: false,
      sessionEvents: false,
    })
    expect(calls.statusSet).toHaveLength(0)
    expect(calls.renderers).toHaveLength(0)
    expect(calls.sections).toHaveLength(0)
    expect(calls.scenes).toHaveLength(0)
    expect(calls.shortcuts).toHaveLength(0)
    expect(calls.maps).toHaveLength(0)
    expect(calls.commands).toHaveLength(0)
    expect(calls.decisions).toHaveLength(0)
  })
})

describe("honest outcomes (no disposer-type inference)", () => {
  test("a refused shortcut registration is reported refused, never confirmed", () => {
    const refusal = () => {}
    const services = {
      tuiShortcuts: {
        register: () => refusal,
        list: () => [],
      },
    }
    const host = hostDouble(services)
    const report = mod.apply(host.ctx as never, {})
    expect(outcomeOf(report, "tuiShortcuts").state).toBe("refused")
    const aggregate = host.infos.find((line) => line.includes("mpd TUI surfaces")) ?? ""
    expect(aggregate).toContain("tuiShortcuts(refused")
    expect(aggregate).not.toContain("tuiShortcuts(confirmed")
  })

  test("a refused renderer registration is reported requested, never confirmed", () => {
    const services = { tuiRenderers: { register: () => () => {} } }
    const host = hostDouble(services)
    const report = mod.apply(host.ctx as never, {})
    expect(outcomeOf(report, "tuiRenderers").state).toBe("requested")
  })

  test("a missing decision grant with a no-op disposer is refused, and the disposer is not called as a probe", () => {
    let disposerCalls = 0
    const services = {
      tuiPluginHost: {
        grants: { allows: () => false },
        subscribeDecision: () => () => {
          disposerCalls += 1
          return false
        },
      },
    }
    const host = hostDouble(services)
    const report = mod.apply(host.ctx as never, {})
    expect(outcomeOf(report, "decisionEvents").state).toBe("refused")
    expect(outcomeOf(report, "decisionEvents").detail).toContain("no grant")
    // Calling the disposer would unregister a real handler — it is a cleanup,
    // never a probe.
    expect(disposerCalls).toBe(0)
    expect(host.warnings.filter((line) => line.includes("ready but NOT activated"))).toHaveLength(1)
  })

  test("a granted decision subscription is confirmed", () => {
    const services = {
      tuiPluginHost: {
        grants: { allows: () => true },
        subscribeDecision: () => () => true,
      },
    }
    const host = hostDouble(services)
    const report = mod.apply(host.ctx as never, {})
    expect(outcomeOf(report, "decisionEvents").state).toBe("confirmed")
    expect(host.warnings.filter((line) => line.includes("ready but NOT activated"))).toHaveLength(0)
  })

  test("without tuiPluginHost the seam is absent and no refusal is claimed", () => {
    const services = { tuiStatus: allServices().services.tuiStatus }
    const host = hostDouble(services)
    const report = mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    expect(outcomeOf(report, "decisionEvents").state).toBe("absent")
    expect(host.warnings.filter((line) => line.includes("ready but NOT activated"))).toHaveLength(0)
  })

  test("admin: the four intercept points are the only decision attempts", () => {
    expect(DECISION_EVENTS.map((entry) => entry.event)).toEqual(["tui/input", "tui/rewind-prompt", "tui/session-switch", "tui/compact"])
    expect(DECISION_EVENTS.map((entry) => entry.permission)).toEqual([
      "session.input.intercept",
      "session.rewind.intercept",
      "session.switch.intercept",
      "session.compact.intercept",
    ])
  })
})

describe("/mpd command grammar (bare = picker, value = direct, status = print)", () => {
  test("bare /mpd uses the picker, then applies the chosen action", async () => {
    const { services, calls } = allServices()
    const servicesWithPicker = {
      ...services,
      tuiDialogs: {
        ...services.tuiDialogs,
        async select() {
          return "status"
        },
      },
    }
    const host = hostDouble(servicesWithPicker)
    mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    const handler = calls.commands[0].handler as (invocation: unknown) => Promise<{ kind: string; text?: string }>
    const result = await handler({ rawInput: "", agent: {} })
    expect(result.kind).toBe("success")
    expect(String(result.text).startsWith("mpd:")).toBe(true)
  })

  test("bare /mpd falls back to the board when no dialog seam is composed", async () => {
    const { services, calls } = allServices()
    delete (services as Record<string, unknown>).tuiDialogs
    const host = hostDouble(services)
    mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    const handler = calls.commands[0].handler as (invocation: unknown) => Promise<{ kind: string }>
    expect((await handler({ rawInput: "", agent: {} })).kind).toBe("success")
    expect(calls.scenes.some((entry) => entry.open === "mpd-tui-board")).toBe(true)
  })

  test("direct actions and the unknown-action error", async () => {
    const { services, calls } = allServices()
    const host = hostDouble(services)
    mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    const handler = calls.commands[0].handler as (invocation: unknown) => Promise<{ kind: string; text?: string }>
    const session = { append: () => {} }
    expect((await handler({ rawInput: " board ", agent: { session } })).kind).toBe("success")
    expect(calls.scenes.some((entry) => entry.open === "mpd-tui-board")).toBe(true)
    expect((await handler({ rawInput: "status" })).kind).toBe("success")
    expect((await handler({ rawInput: "workmates" })).kind).toBe("success")
    const unknown = await handler({ rawInput: "nope" })
    expect(unknown.kind).toBe("error")
    expect(unknown.text).toContain("unknown action")
  })
})

describe("settings section disclosure (t21)", () => {
  test("every mpd.jsonc-referencing hint states that a save is NOT bridged", () => {
    expect(SETTINGS_FIELDS.length).toBeGreaterThan(0)
    for (const field of SETTINGS_FIELDS) {
      expect(field.hint).toBeString()
      expect(field.hint).toContain("mpd.jsonc")
      expect(field.hint).toContain(BRIDGE_DISCLOSURE)
    }
  })

  test("the marker itself says the save does not rewrite the config file", () => {
    // t35 reword: the claim is now the BRIDGE plus the restart, and the old false claim
    // ("not bridged: a save here does not rewrite .mpd/mpd.jsonc") is DELETED, not softened.
    expect(BRIDGE_DISCLOSURE).toContain("a save writes <workspace>/.mpd/mpd.jsonc")
    expect(BRIDGE_DISCLOSURE).toContain("takes effect for the mpd plugins after a restart")
    expect(BRIDGE_DISCLOSURE).not.toContain("not bridged")
    expect(BRIDGE_DISCLOSURE).not.toContain("does not rewrite")
    expect(BRIDGE_NO_WORKSPACE_NOTICE).toBe("saved to settings — not yet written to any .mpd/mpd.jsonc (no live session)")
    // captain ruling 1: the hint also carries the "never lost" clause
    expect(BRIDGE_NOT_LOST).toContain("never lost")
    expect(BRIDGE_NOT_LOST).toContain("every workspace immediately")
  })
})


describe("the §D.2 runtime notice (a save with no live session workspace)", () => {
  test("the notice constant is the design's exact sentence and matches the exported one", () => {
    expect(NO_LIVE_SESSION_NOTICE).toBe("saved to settings — not yet written to any .mpd/mpd.jsonc (no live session)")
    expect(NO_LIVE_SESSION_NOTICE).toBe(BRIDGE_NO_WORKSPACE_NOTICE)
    const state = readBoardState(process.cwd(), process.env.HOME ?? process.cwd())
    expect(statusLine(state)).not.toContain(NO_LIVE_SESSION_NOTICE)
    const withNotice = statusLine(state, NO_LIVE_SESSION_NOTICE)
    expect(withNotice).toContain(NO_LIVE_SESSION_NOTICE)
    expect(withNotice.startsWith("mpd:")).toBe(true)
    // the counts survive in front of the notice
    expect(withNotice.indexOf("plans ")).toBeLessThan(withNotice.indexOf(NO_LIVE_SESSION_NOTICE))
  })

  test("the status line publishes the notice only while the last write-back was skipped for no-live-session", () => {
    const notLive = allServices({ mpdConfig: { states: () => ({ files: [], errors: [], writeback: { skipped: "no-live-session", writtenTo: [], applies: "restart" } }) } })
    mod.apply(hostDouble(notLive.services).ctx as never, { statusIntervalMs: 0 })
    const published = notLive.calls.statusSet.filter((entry: any) => entry.key === STATUS_KEY)
    expect(published.length).toBeGreaterThan(0)
    expect(String(published.at(-1).text)).toContain(NO_LIVE_SESSION_NOTICE)

    // an ambiguous-multi-root refusal gets its OWN sentence (settings-only, candidates in the log)
    const other = allServices({ mpdConfig: { states: () => ({ files: [], errors: [], writeback: { skipped: "ambiguous-multi-root", writtenTo: [], applies: "restart" } }) } })
    mod.apply(hostDouble(other.services).ctx as never, { statusIntervalMs: 0 })
    const otherPublished = other.calls.statusSet.filter((entry: any) => entry.key === STATUS_KEY)
    expect(otherPublished.length).toBeGreaterThan(0)
    expect(String(otherPublished.at(-1).text)).toContain(AMBIGUOUS_MULTI_ROOT_NOTICE)
    expect(String(otherPublished.at(-1).text)).not.toContain("no live session")

    // and a successful write-back clears it again
    const cleared = allServices({ mpdConfig: { states: () => ({ files: [], errors: [], writeback: { writtenTo: ["/ws/.mpd/mpd.jsonc"], results: [], applies: "restart" } }) } })
    mod.apply(hostDouble(cleared.services).ctx as never, { statusIntervalMs: 0 })
    const clearedPublished = cleared.calls.statusSet.filter((entry: any) => entry.key === STATUS_KEY)
    expect(String(clearedPublished.at(-1).text)).not.toContain("no live session")
  })
})
