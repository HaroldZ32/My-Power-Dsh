// This file's copy assertions are LANGUAGE-INDEPENDENT (they read `t(...)`), so no process-wide
// language pin is needed any more: the suite passes under no variable, `en` and `zh` alike.

import { t } from "../src/i18n"
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
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { DshLlmCatalog } from "../../mpd-dsh-adapter-plugin/src/index.js"
import { createTuiAdapter } from "../../mpd-tui-adapter-plugin/src/index.js"
// The adopted cordis body is vendored JavaScript with no declaration file, so these two
// constructors are untyped here; the arms below use only their runtime identity.
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { Context, Service } from "../../mpd-schemastery/harness/cordis/lib/index.ts"
import { SETTINGS_KNOBS, TEAM_MODEL_FALLBACK_OPTIONS, TEAM_MODEL_SLOT_GROUPS, teamModelMembers } from "../../mpd-config-plugin/src/settings-schema"
import { TRANSCRIPT_TYPES } from "../src/renderers"
import { PANEL_ICON } from "../src/panel"
import { WORKMATE_PANEL_ICON } from "../src/panel-workmate"
import { COMMAND_ACTIONS, MODEL_COMMAND } from "../src/command-trees"
import { BRIDGE_DISCLOSURE, BRIDGE_NO_WORKSPACE_NOTICE, BRIDGE_NOT_LOST, registerSettingsSection, SECTION_NOTICE, SETTINGS_FIELDS, SETTINGS_SECTION, teamModelOptionLists } from "../src/settings"
import { createLog } from "../src/log"
import { AMBIGUOUS_MULTI_ROOT_NOTICE, NO_LIVE_SESSION_NOTICE, readBoardState, statusLine } from "../src/state"
import { SHORTCUT_BINDINGS } from "../src/shortcuts"
import { STATUS_KEY } from "../src/status"
import { TEAM_SCENE_ID, registerScene } from "../src/scenes"
import { SUBAGENT_SCENE_ID } from "../src/subagent-scene"
import { DECISION_EVENTS } from "../src/decisions"

/** What a registration returns: a cleanup, or nothing at all. */
type Disposer = () => void | undefined

/**
 * Let the section's detached catalog-read → register chain finish. The twelve slot knobs take
 * their options from the live catalog, which the host freezes at register time, so the
 * registration is one microtask chain behind `apply` by design.
 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** The host double one arm applies the row against. */
interface Double {
  /** The context object handed to `apply`. */
  ctx: Record<string, any>
  /** Every service id the double was asked to `get`. */
  probes: string[]
  /** The dependency list of every `inject` call, in call order. */
  injections: string[][]
  /** Cleanups the row handed to `effect`. */
  cleanups: Disposer[]
  /** Warning lines the double's logger received. */
  warnings: string[]
  /** Info lines the double's logger received. */
  infos: string[]
  /** Debug lines the double's logger received. */
  debugs: string[]
  /** The services this double can inject. */
  services: Record<string, any>
}

/** Knobs that make one arm's host behave differently. */
interface DoubleOptions {
  /** Model an older/plain ctx with no `inject` at all (the inject-free case). */
  injectSupported?: boolean
  /** Models the grant facade: whether a permission at a scope is authorised. */
  grants?: (permission: string, scope: string) => boolean
}

/** Builds a host double whose injected scopes are the only way to reach a service. */
function hostDouble(services: Record<string, any> = {}, options: DoubleOptions = {}): Double {
  /** Every service id the double was asked to `get`. */
  const probes: string[] = []
  /** The dependency list of every `inject` call, in call order. */
  const injections: string[][] = []
  /** Cleanups the row handed to `effect`. */
  const cleanups: Disposer[] = []
  /** Warning lines the double's logger received. */
  const warnings: string[] = []
  /** Info lines the double's logger received. */
  const infos: string[] = []
  /** Debug lines the double's logger received. */
  const debugs: string[] = []

  /** Builds one context object; every injected scope gets its own. */
  const build = (): Record<string, any> => {
    /** The context under construction. */
    const ctx: Record<string, any> = {
      // Inject-free visibility: the service is NOT reachable here.
      /** Inject-free visibility: no service is reachable through `get` here. */
      get(name: string, strict?: boolean): undefined {
        probes.push(name)
        void strict
        return undefined
      },
      /** Runs the cleanup once and records it, as the host's fiber ownership would. */
      effect(callback: () => Disposer): Record<string, never> {
        /** The cleanup this effect returned, when it returned one. */
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
        /** The injected scope, whose `get` resolves the mounted services. */
        const scoped = build()
        // Inside an injected scope the service IS reachable (measured).
        scoped.get = (name: string) => services[name]
        /** Whether every declared dependency is composed. */
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
  /** One array per service method, in call order. */
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
    views: [],
    // The sidebar panel seam's own log: one entry per registration, and one per open request.
    panels: [],
    panelOpens: [],
  }
  /** How many times a recorded disposer was called. */
  const disposed = { count: 0 }
  /** Decision disposer calls; the arms assert this stays 0. */
  const decisionDisposerCalls = { count: 0 }
  /** The no-op disposer every mutating registration returns. */
  const disposer = (): void => {
    disposed.count += 1
  }
  /** The recording double for every service this row touches. */
  const services: Record<string, any> = {
    // The config layer's own surface: the status line reads the LAST settings-bridge outcome
    // from it (§D.2 row 2). Overridable per test through `overrides`.
    mpdConfig: { states: () => ({ files: [], errors: [], writeback: null }) },
    tuiStatus: {
      /** Records the contribution and returns the shared no-op disposer. */
      set(key: string, text: unknown): () => void {
        calls.statusSet.push({ key, text })
        return disposer
      },
      /** The rich companion (host `registerView`): records the descriptor and returns the disposer. */
      registerView(descriptor: { key: string; maxRows?: number; component: unknown }): () => void {
        calls.views.push(descriptor)
        return disposer
      },
    },
    tuiRenderers: {
      /** Records the renderer registration and returns the shared disposer. */
      register(type: string, renderer: unknown): () => void {
        calls.renderers.push({ type, renderer })
        return disposer
      },
    },
    tuiSettingsSections: {
      /** Records the section registration and returns the shared disposer. */
      register(section: unknown): () => void {
        calls.sections.push(section)
        return disposer
      },
    },
    tuiScenes: {
      /** Records the scene descriptor and returns the shared disposer. */
      register(descriptor: unknown): () => void {
        calls.scenes.push(descriptor)
        return disposer
      },
      /** Opens a scene id: the double records it and always succeeds. */
      open(id: string): boolean {
        calls.scenes.push({ open: id })
        return true
      },
    },
    tuiShortcuts: (() => {
      /** The combos this double's own `list()` read-back serves. */
      const owned: { combo: string; description: string }[] = []
      return {
        /** Records the binding in the host's own list and returns the shared disposer. */
        register(combo: string, definition: { description: string }): () => void {
          calls.shortcuts.push({ combo, description: definition?.description })
          owned.push({ combo, description: definition?.description })
          return disposer
        },
        /** The host's read-back: the combos this activation owns. */
        list(): { combo: string; description: string }[] {
          return owned
        },
      }
    })(),
    tuiCommandTrees: {
      /** Records the completion provider and returns the shared disposer. */
      register(provider: unknown): () => void {
        calls.maps.push(provider)
        return disposer
      },
    },
    // THE SIDEBAR PANEL SEAM (dsh-tui 0.13.0). It is present here because this double models the host
    // the bundle targets; an arm that needs a PRE-0.13.0 host deletes it from the service map, which
    // is exactly what makes `panelSeamBound()` false and the legacy Ctrl+A contact arm.
    tuiPanels: (() => {
      /** The panels this activation registered, in registration order (the host's own read-back). */
      const owned: { id: string; title: string; source: string }[] = []
      /** How many panels the host's own activation prefix names (a real host composes `act<N>:<slug>`). */
      let activation = 0
      return {
        /** Registers one panel under the host-composed id and returns the host's own disposer. */
        register(descriptor: { id: string; title: string }): () => void {
          calls.panels.push(descriptor)
          owned.push({ id: `act${activation}:${descriptor.id}`, title: descriptor.title, source: "plugin" })
          return disposer
        },
        /** The host's own read-back: ONLY the calling activation's panels. */
        list(): { id: string; title: string; source: string }[] {
          return owned
        },
        /** Opens one of this activation's panels: the double always accepts. */
        open(id: string): boolean {
          calls.panelOpens.push(id)
          return true
        },
        /** Names the activation prefix a test wants (the real host's `act<N>` fallback form). */
        setActivation(next: number): void {
          activation = next
        },
      }
    })(),
    tuiDialogs: {
      /** No picker in this double: every dialog request resolves undefined. */
      async select(): Promise<undefined> {
        return undefined
      },
      /** No yes/no dialog in this double: the request resolves undefined. */
      async confirm(): Promise<undefined> {
        return undefined
      },
      /** No text dialog in this double: the request resolves undefined. */
      async input(): Promise<undefined> {
        return undefined
      },
    },
    settings: {
      /** Records the namespace registration; a duplicate would throw on a real host. */
      register(ns: string, schema: unknown, options: unknown): Record<string, never> {
        calls.namespaces.push({ ns, schema, options })
        return {}
      },
    },
    commands: {
      /** Records the command definition and returns the shared disposer. */
      register(definition: unknown): () => void {
        calls.commands.push(definition)
        return disposer
      },
    },
    tuiPluginHost: {
      grants: { allows: () => false },
      /** The measured production behaviour: the identity assertion throws before any policy. */
      subscribeDecision(_ctx: unknown, event: string): never {
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

/** Looks one seam's outcome up in the report, failing loudly when it is missing. */
function outcomeOf(report: mod.ApplyReport, id: string): { state: string; detail?: string } {
  /** That report entry, or undefined when the row recorded none. */
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
      // The dsh-tui 0.13.0 sidebar panel surface: contributed by default, and routed to by
      // `alt+a` / `/mpd panel` (with the full-screen scene as the declared fallback).
      panel: true,
      // The Ctrl+A takeover's FLOOR: the row config default. A saved `tui.dashboardKey` (the /settings
      // row) outranks it per press, so this stays true for every composition that never saves one.
      dashboardKey: true,
      sessionEvents: true,
      decisionEvents: true,
      logPrefix: "mpd-tui",
    })
  })

  test("the schema rejects a wrong type instead of silently dropping it", () => {
    // The schema is the LAST guard on a row value the loader did not validate, so this arm feeds a
    // wrong-typed input on purpose: no well-typed literal can express the value under test.
    expect(() => mod.Config({ statusIntervalMs: "soon" } as never)).toThrow()
  })

  test("resolveConfig defaults every key and repairs an invalid interval", () => {
    // The schema's call signature returns the PARTIAL `Config`, while its zod defaults fill every
    // key at runtime — the value compared here really is the fully resolved shape.
    expect(mod.resolveConfig({})).toEqual(mod.Config({}) as mod.ResolvedConfig)
    expect(mod.resolveConfig({ statusIntervalMs: -1 }).statusIntervalMs).toBe(3000)
    expect(mod.resolveConfig({ statusIntervalMs: Number.NaN }).statusIntervalMs).toBe(3000)
    expect(mod.resolveConfig({ statusLine: false }).statusLine).toBe(false)
    expect(mod.resolveConfig({ logPrefix: "" }).logPrefix).toBe("mpd-tui")
  })
})

describe("T4-INERT-1: activation requires the inject form", () => {
  test("a ctx WITHOUT inject registers nothing, even when get() would answer", () => {
    /** The recording services to apply against. */
    const { services } = allServices()
    /** A host double with `inject` unsupported. */
    const host = hostDouble(services, { injectSupported: false })
    // Model the old failure: get() answering is exactly what the first version
    // relied on, and it is NOT how the host exposes a service.
    host.ctx.get = (name: string) => services[name]
    /** The report `apply` returned. */
    const report = mod.apply(host.ctx as never, {})
    expect(host.injections).toHaveLength(0)
    expect(outcomeOf(report, "tuiStatus").state).toBe("absent")
    expect(outcomeOf(report, "tuiScenes").state).toBe("absent")
    expect(host.warnings.some((line) => line.includes("no DSH-TUI service is composed"))).toBe(true)
  })

  test("with inject supported but no service composed, nothing is registered and nothing throws", () => {
    /** A host double with `inject` supported but no service composed. */
    const host = hostDouble({})
    /** The report `apply` returned. */
    const report = mod.apply(host.ctx as never, {})
    expect(host.injections.length).toBeGreaterThan(0) // the attempts were made
    for (const entry of report.outcomes) expect(entry.outcome.state).toBe("absent")
    expect(host.cleanups).toHaveLength(0)
  })

  test("apply survives a throwing ctx.get and a ctx without effect()", () => {
    /** A host double whose `get` throws and whose ctx has no `effect`. */
    const host = hostDouble({})
    host.ctx.get = () => {
      throw new Error('cannot get property "commands" without inject')
    }
    delete host.ctx.effect
    expect(() => mod.apply(host.ctx as never, {})).not.toThrow()
  })
})

describe("full composition (every service injected)", () => {
  test("every seam activates through ctx.inject and reports an honest outcome", async () => {
    /** The recording services and the call log. */
    const { services, calls } = allServices()
    /** A host double with every service composed. */
    const host = hostDouble(services)
    /** The report `apply` returned. */
    const report = mod.apply(host.ctx as never, { statusIntervalMs: 0 })

    // The activation channel is inject, per seam.
    const injected = host.injections.map((entry) => entry[0])
    for (const id of ["tuiStatus", "tuiRenderers", "tuiSettingsSections", "tuiScenes", "tuiCommandTrees", "tuiShortcuts", "tuiDialogs", "commands", "tuiPluginHost", "settings", "tuiPanels"]) {
      expect(injected).toContain(id)
    }

    // tuiPanels: exactly TWO sidebar panels (frozen clause C3) — the MPD panel, which RENDERS the DAG
    // page, and the workmate page — each with the frozen descriptor of its own module, and each final id
    // DISCOVERED from the host's own `list()` read-back (never composed on this side). THE COUNT IS THE
    // CLAUSE: the standalone merged page and the standalone DAG page do not both survive, so a third
    // registration here would be the "both survive" the clause forbids. The host budgets a plugin at four
    // (`MAX_PANELS_PER_PLUGIN`), so two is well inside it and this assertion is what keeps a third from
    // being added unnoticed.
    expect(calls.panels).toHaveLength(2)
    expect(calls.panels[0].apiVersion).toBe(1)
    expect(calls.panels[0].id).toBe("team")
    expect(calls.panels[0].title).toBe("MPD")
    expect(calls.panels[0].minColumns).toBe(28)
    expect(calls.panels[0].order).toBe(10)
    // AMENDED (wave `tui-dag-highlight`, AC8) — the merged page now DECLARES an icon instead of letting
    // the host fall back to the letter `M`. Asserted SYMBOLICALLY (the module's own constant), so the
    // Chrome lane's choice of glyph is its own to change.
    expect(calls.panels[0].icon).toBe(PANEL_ICON)
    expect(calls.panels[0].compact).toBeUndefined()
    expect(typeof calls.panels[0].component).toBe("function")
    expect(outcomeOf(report, "panel").state).toBe("confirmed")
    expect(String(outcomeOf(report, "panel").detail)).toContain("act0:team")
    // AMENDED (wave `tui-014-adaptation`, clause C3) — THE DAG PAGE NO LONGER REGISTERS ONE OF ITS OWN.
    // It merged into the panel above: slug, descriptor and ordered position collapsed, and the page's
    // RENDERER is what the surviving slot now draws (asserted through `panel.ts`'s own arm, which renders
    // the component and reads the rich chrome out of it). The absence is the clause, so it is asserted
    // rather than merely removed: a `dag` slug reappearing here would be "both survive" again.
    expect(calls.panels.map((entry) => entry.id)).not.toContain("dag")
    expect(calls.panels.map((entry) => entry.id)).not.toContain("team-dag")
    // No outcome entry names a DAG page any more either — the aggregate would otherwise report a surface
    // the host was never offered.
    expect(report.outcomes.some((entry) => String(entry.id).includes("dag"))).toBe(false)
    // The workmate page: the SECOND surviving surface, and the only other registration.
    expect(calls.panels[1].apiVersion).toBe(1)
    expect(calls.panels[1].id).toBe("workmate")
    expect(calls.panels[1].title).toBe("MPD workmate")
    // AMENDED (wave `tui-dag-highlight`, AC8) — the workmate page's icon CHANGED from the pin marker
    // `◆` (U+25C6), which is byte-identical to the host's own `agents` tab, to its own glyph. Asserted
    // symbolically: two panels, two glyphs, neither borrowed from the host's panel bar.
    expect(calls.panels[1].icon).toBe(WORKMATE_PANEL_ICON)
    expect(new Set([calls.panels[0].icon, calls.panels[1].icon]).size).toBe(2)
    expect(calls.panels[1].minColumns).toBe(28)
    expect(calls.panels[1].order).toBe(12)
    expect(typeof calls.panels[1].component).toBe("function")
    expect(outcomeOf(report, "workmatePanel").state).toBe("confirmed")
    expect(String(outcomeOf(report, "workmatePanel").detail)).toContain("act0:workmate")

    // tuiStatus: one live keyed contribution under the conventions' key.
    expect(STATUS_KEY).toBe("mpd-tui")
    /** The contributions published under the plugin's own status key. */
    const published = calls.statusSet.filter((entry) => entry.key === STATUS_KEY)
    expect(published.length).toBeGreaterThan(0)
    expect(String(published[0].text).startsWith("mpd:")).toBe(true)
    expect(outcomeOf(report, "tuiStatus").state).toBe("requested")
    // No bridge outcome yet: the line carries the counts and NO notice.
    expect(String(published[0].text)).not.toContain("no live session")

    // tuiRenderers: one renderer per declared log-only type.
    expect(calls.renderers.map((entry) => entry.type)).toEqual([...TRANSCRIPT_TYPES])
    expect(outcomeOf(report, "tuiRenderers").state).toBe("requested")

    // tuiSettingsSections: the mpd.jsonc section, with the on-screen disclosure. The section
    // registers one microtask behind apply: the twelve team-model slot knobs take their option
    // lists from the live model catalog the adapter reports, and the host DEEP-FREEZES the
    // options at register time (it renders `select` by cycling that frozen list).
    await settle()
    expect(calls.sections).toHaveLength(1)
    // The section is keyed by the ENTRY the settings machinery serves it under, not by the retired
    // namespace name: measured on a live boot, values resolved for "mpd-config" and never for "mpd".
    expect(calls.sections[0].ns).toBe("mpd-config")
    // 26 = the ONE shared declaration's knob count (SETTINGS_KNOBS in mpd-config-plugin): the
    // thirteen original mpd knobs, the twelve team-model slot leaves (4 slots x provider / model /
    // reasoningEffort) and the TUI surface's own `tui.dashboardKey` (the Ctrl+A takeover toggle,
    // which this section renders through the SAME declaredField path as every other row). The
    // per-field assertions below are the other half of the no-drift pair.
    expect(calls.sections[0].fields).toHaveLength(26)
    for (const field of calls.sections[0].fields) {
      expect(field.hint).toContain("mpd.jsonc")
      // The disclosure is stated ONCE on the surface (the section's own description), never per row.
      expect(field.hint).not.toContain(BRIDGE_DISCLOSURE)
      expect(field.hint).not.toContain(BRIDGE_NOT_LOST)
    }
    // ...and the surface states BOTH halves once, where a reader meets them before any row.
    expect(String(calls.sections[0].descriptions?.en)).toContain(BRIDGE_DISCLOSURE)
    expect(String(calls.sections[0].descriptions?.en)).toContain(BRIDGE_NOT_LOST)
    // This double composes no `llm`, so every slot knob is on the DECLARED fallback branch —
    // and none of them may ever carry an empty option list (a slot must never need typing).
    const slotFields = calls.sections[0].fields.filter((field: any) => field.path[0] === "teamModels")
    expect(slotFields).toHaveLength(12)
    for (const field of slotFields) {
      expect(field.kind).toBe("select")
      expect(field.options.length).toBeGreaterThan(0)
      // The declared lists are a readonly literal object, so a runtime-resolved leaf needs a
      // dictionary view before it can select one (the same reading the degraded-catalog arm uses).
      expect(field.options).toEqual((TEAM_MODEL_FALLBACK_OPTIONS as Record<string, readonly string[]>)[field.path[2]].map((value: string) => ({ value, label: value })))
    }

    // tuiScenes: the board scene.
    expect(calls.scenes.filter((entry) => entry.id === "mpd-tui-board")).toHaveLength(1)

    // tuiShortcuts: registered AND confirmed through the host's list() read-back.
    expect(calls.shortcuts.map((entry) => entry.combo)).toEqual(SHORTCUT_BINDINGS.map((binding) => binding.combo))
    /** The shortcut seam's measured outcome. */
    const shortcutsOutcome = outcomeOf(report, "tuiShortcuts")
    expect(shortcutsOutcome.state).toBe("confirmed")
    expect(shortcutsOutcome.detail).toContain("alt+m")

    // tuiCommandTrees + commands: the tree roots match the registered commands. TWO providers are
    // expected since R3 — `/mpd` (its subcommands) and `/mpd-model` (the pick-list command, whose
    // panel arguments are picked, never typed, so it completes nothing below its root).
    expect(calls.maps.map((entry: { root: string }) => entry.root).sort()).toEqual([MODEL_COMMAND, "mpd"].sort())
    /** The `/mpd` tree provider this arm asserts the subcommands of. */
    const mpdTree = calls.maps.find((entry: { root: string }) => entry.root === "mpd")
    expect(mpdTree.root).toBe("mpd")
    // CONTENT-ROBUST: the completion advertises EXACTLY the declarative action list, in any order,
    // whatever that list is. Freezing the literal here would make a grammar addition (Lane C's
    // `subagents`) a test edit in two places; comparing against the module's own declaration keeps
    // the invariant that matters — the tree and the grammar cannot drift apart.
    expect([...mpdTree.children(["mpd"]).map((node: { name: string }) => node.name)].sort()).toEqual([...COMMAND_ACTIONS].sort())
    // R4: every node carries BOTH languages, and its `en` half IS the fallback description.
    for (const node of mpdTree.children(["mpd"])) {
      expect(node.descriptions?.zh).toBeString()
      expect(node.descriptions?.en).toBe(node.description)
    }
    expect(mpdTree.descriptions?.en).toBeString()
    expect(calls.commands).toHaveLength(2)
    expect(calls.commands.map((entry: { name: string }) => entry.name).sort()).toEqual(["mpd", MODEL_COMMAND].sort())

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
    /** The recording services, the call log and the dispose counter. */
    const { services, calls, disposed } = allServices()
    /** A host double with every service composed. */
    const host = hostDouble(services)
    mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    expect(host.cleanups.length).toBeGreaterThan(0)
    for (const cleanup of host.cleanups) cleanup()
    expect(disposed.count).toBeGreaterThan(0)
    expect(calls.statusSet.some((entry) => entry.text === undefined && entry.key === STATUS_KEY)).toBe(true)
  })

  test("each seam can be disabled by config, and disabling keeps apply inert", () => {
    /** The recording services and the call log. */
    const { services, calls } = allServices()
    /** A host double with every service composed. */
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

/**
 * The two-provider catalog the A4 tests project: provider labels are the catalog's provider
 * NAMES, model/effort labels their own names, and every value is the raw id the settings
 * document stores (so `deepseek-official` / `deepseek-v4-flash` / `max` stay the vocabulary).
 *
 * Typed as the adapter's OWN catalog shape, so the very same object can be handed to the
 * `llmCatalog()` seam the settings section reads.
 */
const TWO_PROVIDER_CATALOG: DshLlmCatalog = {
  providers: [
    {
      id: "deepseek-official",
      name: "DeepSeek Official",
      models: [
        {
          id: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          efforts: [{ id: "max", name: "Max" }, { id: "high", name: "High" }],
          defaultEffort: "max",
        },
      ],
    },
    {
      id: "pi-ai",
      name: "pi-ai",
      models: [{ id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", efforts: [{ id: "high", name: "High" }] }],
    },
  ],
  degraded: false,
}

/** Apply the row against a host whose MOUNTED adapter answers `llmCatalog()`. */
async function applyWithAdapter(llmCatalog: () => Promise<unknown>): Promise<{ calls: Record<string, any[]>; host: Double }> {
  /** The recording services and the call log. */
  const { services, calls } = allServices()
  /** A host double with every service composed. */
  const host = hostDouble(services)
  host.ctx.get = (name: string) => (name === "mpdDsh" ? { llmCatalog } : undefined)
  mod.apply(host.ctx as never, { statusIntervalMs: 0 })
  await settle()
  return { calls, host }
}

describe("A4: the twelve team-model slot knobs select from the live catalog", () => {
  /** Finds one registered field by its dotted path, failing loudly when it is absent. */
  const fieldAt = (section: any, path: string): any => {
    /** That field, or undefined when the section carries none. */
    const found = section.fields.find((candidate: any) => candidate.path.join(".") === path)
    if (found === undefined) throw new Error(`no field at ${path}`)
    return found
  }
  /** The twelve team-model slot fields of a registered section. */
  const slotFields = (section: any): any[] => section.fields.filter((field: any) => field.path[0] === "teamModels")

  test("derives provider / model / effort options from a two-provider catalog", async () => {
    /** The call log and the host, after the catalog read settled. */
    const { calls, host } = await applyWithAdapter(async () => TWO_PROVIDER_CATALOG)
    /** The one registered section. */
    const section = calls.sections[0]
    expect(fieldAt(section, "teamModels.slot1.provider").options).toEqual([
      { value: "deepseek-official", label: "DeepSeek Official" },
      { value: "pi-ai", label: "pi-ai" },
    ])
    // the UNION of the catalog's model ids, in catalog order, first label per id
    expect(fieldAt(section, "teamModels.slot2.model").options).toEqual([
      { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    ])
    // the UNION of every model's effort ids (deduped: `high` is declared twice)
    expect(fieldAt(section, "teamModels.slot3.reasoningEffort").options).toEqual([
      { value: "max", label: "Max" },
      { value: "high", label: "High" },
    ])
    // all twelve: `select` with a NON-EMPTY list — no slot is ever a text input
    expect(slotFields(section)).toHaveLength(12)
    for (const field of slotFields(section)) {
      expect(field.kind).toBe("select")
      expect(field.options.length).toBeGreaterThan(0)
    }
    // the other thirteen keep their declared metadata byte-for-byte
    expect(section.fields.slice(0, 13).map((field: any) => [field.path.join("."), field.kind, field.label]))
      .toEqual(SETTINGS_FIELDS.slice(0, 13).map((field) => [field.path.join("."), field.kind, field.label]))
    // the branch is RECORDED (A4's measurement requirement: non-empty alone is not enough)
    const line = host.infos.find((entry) => entry.includes("slot options: provider=")) ?? ""
    expect(line).toContain("provider=live(2)")
    expect(line).toContain("model=live(2)")
    expect(line).toContain("reasoningEffort=live(2)")
    expect(line).toContain("catalog=live")
  })

  test("the three NEW slot-4 rows register as selects with non-empty options and the declared labels/zh", async () => {
    /** The call log, after the catalog read settled. */
    const { calls } = await applyWithAdapter(async () => ({ providers: [], degraded: true }))
    /** The one registered section. */
    const section = calls.sections[0]
    /** The three slot-4 rows, i.e. the vision member's route. */
    const vision = section.fields.filter((field: any) => field.path[0] === "teamModels" && field.path[1] === "slot4")
    expect(vision).toHaveLength(3)
    /** The three shared declarations those rows must mirror. */
    const declared = SETTINGS_KNOBS.filter((knob) => knob.path[1] === "slot4")
    for (const [index, field] of vision.entries()) {
      // element-wise against the ONE declaration — the front doors cannot drift
      expect([...(field.path as string[])]).toEqual([...declared[index].path])
      expect(field.kind).toBe("select")
      expect(field.options.length).toBeGreaterThan(0)
      expect(field.label).toBe(declared[index].label)
      expect(field.descriptions?.zh).toBe(declared[index].zh)
      expect(String(field.hint).startsWith(String(declared[index].semantics))).toBe(true)
    }
    expect(vision.map((field: any) => field.label)).toEqual([
      "Slot 4 provider (vision member)", "Slot 4 model (vision member)", "Slot 4 reasoning effort (vision member)",
    ])
    expect(vision.map((field: any) => field.descriptions?.zh)).toEqual([
      "槽位 4 提供商（视觉成员）", "槽位 4 模型（视觉成员）", "槽位 4 推理强度（视觉成员）",
    ])
  })

  test("a degraded catalog falls back to the declared option lists", async () => {
    /** The call log and the host, after the catalog read settled. */
    const { calls, host } = await applyWithAdapter(async () => ({ providers: [], degraded: true }))
    /** The one registered section. */
    const section = calls.sections[0]
    for (const field of slotFields(section)) {
      expect(field.kind).toBe("select")
      expect(field.options).toEqual((TEAM_MODEL_FALLBACK_OPTIONS as Record<string, readonly string[]>)[field.path[2]].map((value) => ({ value, label: value })))
    }
    /** The A4 branch line logged for this registration. */
    const line = host.infos.find((entry) => entry.includes("slot options: provider=")) ?? ""
    expect(line).toContain("provider=declared(1)")
    expect(line).toContain("model=declared(4)")
    expect(line).toContain("reasoningEffort=declared(4)")
    expect(line).toContain("catalog=degraded")
  })

  test("a mounted adapter WITHOUT the seam (an older build) degrades to the declared lists", async () => {
    /** The recording services and the call log. */
    const { services, calls } = allServices()
    /** A host double whose mounted adapter predates the catalog seam. */
    const host = hostDouble(services)
    host.ctx.get = (name: string) => (name === "mpdDsh" ? {} : undefined)
    mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    await settle()
    expect(calls.sections).toHaveLength(1)
    expect(fieldAt(calls.sections[0], "teamModels.slot1.provider").options)
      .toEqual(TEAM_MODEL_FALLBACK_OPTIONS.provider.map((value) => ({ value, label: value })))
  })

  test("the REAL adapter seam (t2) feeds the same projection end to end", async () => {
    // A real createDshAdapter over a fake host `llm` service — the llmCatalog projection
    // itself, not a hand-rolled stub — so this proves the wiring A4 depends on.
    const llm = {
      listProviders: () => [{ id: "deepseek-official", name: "DeepSeek Official" }],
      listModels: async () => [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
      resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: "max", name: "Max" }], defaultEffort: "max" } }),
    }
    /** The recording services and the call log. */
    const { services, calls } = allServices()
    /** A host double with every service composed. */
    const host = hostDouble(services)
    /** A REAL adapter over a fake `llm` service, so the wiring itself is under test. */
    const adapter = createDshAdapter({ get: (name: string) => (name === "llm" ? llm : undefined) })
    host.ctx.get = (name: string) => (name === "mpdDsh" ? adapter : undefined)
    mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    await settle()
    expect(fieldAt(calls.sections[0], "teamModels.slot1.model").options)
      .toEqual([{ value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" }])
    expect(fieldAt(calls.sections[0], "teamModels.slot1.reasoningEffort").options)
      .toEqual([{ value: "max", label: "Max" }])
  })

  test("the section registers EXACTLY once per ns, even when the activation fires twice", async () => {
    /** Every section the service double received. */
    const registered: unknown[] = []
    /** A section service that records registrations. */
    const service = { register: (section: unknown) => { registered.push(section); return () => {} } }
    /** The scope whose `get` resolves that service. */
    const scoped = { get: (name: string) => (name === "tuiSettingsSections" ? service : undefined) }
    /** A context double whose activation fires twice. */
    const ctx: Record<string, any> = {
      get: () => undefined,
      inject: (_deps: readonly string[], callback: (scope: unknown) => void) => { callback(scoped); callback(scoped); return {} },
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    }
    registerSettingsSection(ctx as never, createTuiAdapter(ctx as never), createLog(ctx.logger, "mpd-tui"), { llmCatalog: async () => TWO_PROVIDER_CATALOG })
    await settle()
    expect(registered).toHaveLength(1)
  })

  test("a DEFERRED register through the injected scope keeps a live non-root caller (the cordis binding late registration relies on)", async () => {
    // Code-path proof of the ONE risky step in this design: the deferred `register()` runs
    // after the inject callback returned, so the caller must still resolve to the INJECTED
    // scope — the host's registry rejects a root or absent caller ("requires a live non-root
    // calling activation"). A MOUNTING boot is the real-host evidence and belongs to t9.
    // A root context whose Proxy-installed `plugin` member the class type does not declare.
    const root = new Context() as unknown as { plugin(plugin: unknown, config?: unknown): unknown }
    /** The `this.ctx` each registration observed. */
    const callers: unknown[] = []
    /** The service whose `register` reports its own calling context. */
    class Sections extends Service {
      /** Registers the service under the seam id the consumer injects. */
      constructor(ctx: any) { super(ctx, "tuiSettingsSections") }
      /** Records the calling context; a real host rejects a root or absent caller. */
      register(_section: unknown): () => void {
        // The vendored cordis `Service` base is untyped JavaScript, so the scope a service carries
        // is invisible on this class's type: this reads back the identity a host registry checks.
        callers.push((this as unknown as { ctx: unknown }).ctx)
        return () => {}
      }
    }
    /** Installs the service into the plugin's scope. */
    root.plugin({
      name: "a4-sections",
      /** Installs the service into the plugin's own scope. */
      apply(inner: any): void {
        new Sections(inner)
      },
    } as any)
    /** The consumer plugin, whose deferred call is the risky step under test. */
    const consumer = root.plugin({
      name: "a4-consumer",
      inject: ["tuiSettingsSections"],
      /** Resolves the service BOTH ways and registers through each, after apply returned. */
      apply(scoped: any): void {
        /** The service resolved through the scoped soft probe. */
        const viaGet = scoped.get("tuiSettingsSections", false)
        /** The service resolved as a scope property. */
        const viaProperty = scoped.tuiSettingsSections
        setTimeout(() => {
          viaGet.register({ ns: "a", title: "a", fields: [] })
          viaProperty.register({ ns: "b", title: "b", fields: [] })
        }, 0)
      },
    } as any)
    await (consumer as any)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(callers).toHaveLength(2)
    for (const caller of callers) {
      expect(Context.is(caller)).toBe(true)
      expect(caller === root).toBe(false)
    }
  })

  test("the projection is TOTAL: no catalog, a degraded catalog or a malformed one never yields an empty list", () => {
    /** Builds the declared fallback options of one leaf. */
    const declared = (leaf: "provider" | "model" | "reasoningEffort"): { value: string; label: string }[] =>
      (TEAM_MODEL_FALLBACK_OPTIONS as Record<string, readonly string[]>)[leaf].map((value) => ({ value, label: value }))
    expect(teamModelOptionLists(undefined).source).toEqual({ provider: "declared", model: "declared", reasoningEffort: "declared" })
    expect(teamModelOptionLists(undefined).provider).toEqual(declared("provider"))
    // a DEGRADED read is treated as no read, even when it still carries a provider
    const partial = teamModelOptionLists({ providers: [{ id: "p", name: "P", models: [] }], degraded: true } as never)
    expect(partial.provider).toEqual(declared("provider"))
    expect(partial.source.provider).toBe("declared")
    // a malformed catalog object cannot throw and cannot empty a list
    const junk = teamModelOptionLists({ providers: "nope", degraded: false } as never)
    expect(junk.provider.length).toBeGreaterThan(0)
    expect(junk.model).toEqual(declared("model"))
    expect(junk.source.model).toBe("declared")
  })
})

/**
 * A minimal host kit double for the scene render.
 *
 * It carries exactly the members a scene body touches plus `useStdin` — the one member the scene
 * wiring exists to hand the adapter. Hooks are index-free stubs (state is not re-read in this arm)
 * and elements are plain records, so a render is a pure function call with no reconciler.
 * @returns the React instance and the ui kit a scene receives.
 */
function sceneKitDouble(): { React: Record<string, unknown>; ui: Record<string, unknown>; stdin: unknown } {
  /** The value the kit's own `useStdin` answers; the adapter keeps whatever this kit exposes. */
  const stdin = { internal_querier: {}, internal_eventEmitter: {} }
  /** The React double: enough for a single render of any scene body. */
  const React: Record<string, unknown> = {
    /** Builds an element record instead of a real element. */
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown => ({ type, props: props ?? {}, children }),
    /** A state pair whose setter is inert: no re-render happens in this arm. */
    useState: (initial: unknown): [unknown, () => void] => [typeof initial === "function" ? (initial as () => unknown)() : initial, () => {}],
    /** Runs the effect once and drops its cleanup. */
    useEffect: (effect: () => unknown): void => {
      effect()
    },
    /** A fresh ref object. */
    useRef: (initial: unknown): { current: unknown } => ({ current: initial }),
    /** Compares nothing: a fresh value per render is fine for one pass. */
    useMemo: (factory: () => unknown): unknown => factory(),
    /** Returns the factory as-is. */
    useCallback: (callback: unknown): unknown => callback,
    /** Reads the snapshot, ignoring the subscription. */
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown): unknown => snapshot(),
  }
  /** The ui kit double: the members a scene body uses, plus the hook under test. */
  const ui: Record<string, unknown> = {
    /** An element record. */
    Box: (props: Record<string, unknown>) => ({ type: "Box", props, children: [] }),
    /** An element record. */
    Text: (props: Record<string, unknown>) => ({ type: "Text", props, children: [] }),
    /** Accepts the scene's key handler and drops it. */
    useInput: () => {},
    /** A fixed terminal size. */
    useTerminalSize: (): { columns: number; rows: number } => ({ columns: 120, rows: 40 }),
    /** THE MEMBER THIS ARM IS ABOUT: the host's own stdin hook travels with the kit. */
    useStdin: (): unknown => stdin,
  }
  return { React, ui, stdin }
}

describe("the Ctrl+A takeover wiring (W2)", () => {
  test("on a host WITH the panel seam the contact stays INERT (the version gate)", () => {
    // The frozen rule (R5/R4): where the host offers `ctx.tuiPanels` (dsh-tui 0.13.0+), Ctrl+A keeps
    // its host dashboard meaning and MPD's own key/command are the entry points — so the legacy
    // host-input contact must register NOTHING at all.
    /** The recording services and the call log. */
    const { services, calls } = allServices()
    /** A host double with every service composed — the panel seam included. */
    const host = hostDouble(services)
    /** The report `apply` returned. */
    const report = mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    expect(calls.views).toHaveLength(0)
    /** The gate's own record: skipped, with the reason a reader needs. */
    const gated = outcomeOf(report, "dashboardKey")
    expect(gated.state).toBe("absent")
    expect(String(gated.detail)).toContain("panel seam")
    // The panel itself is the surface that replaces it.
    expect(outcomeOf(report, "panel").state).toBe("confirmed")
    // …and the status seam (which the hook rides) still reports its own, separate outcome.
    expect(outcomeOf(report, "tuiStatus").state).toBe("requested")
  })

  test("on a host WITHOUT the panel seam the contact arms (the legacy path)", () => {
    /** The recording services and the call log. */
    const { services, calls } = allServices()
    // A pre-0.13.0 host: the panel service is not composed at all.
    delete (services as Record<string, unknown>).tuiPanels
    /** A host double with every other service composed. */
    const host = hostDouble(services)
    /** The report `apply` returned. */
    const report = mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    /** The keyhook's own view registration, out of every rich view the host received. */
    const hook = calls.views.find((view) => view.key === "mpd-tui-keyhook")
    expect(hook).toBeDefined()
    // 1 row, not 0: the host's own validator refuses 0 (it requires an integer 1..3), so the ZERO is
    // rendered by the empty Box the component returns.
    expect(hook?.maxRows).toBe(1)
    expect(typeof hook?.component).toBe("function")
    expect(outcomeOf(report, "dashboardKey").state).toBe("requested")
    // The panel registration is attempted and settles ABSENT rather than throwing (the deferred binder
    // degrades on a host that never offers the seam).
    expect(outcomeOf(report, "panel").state).toBe("absent")
  })
})

describe("the Ctrl+A takeover wiring (W2)", () => {
  test("with the row config off, the contact stays inert on BOTH host generations", () => {
    /** The recording services and the call log. */
    const { services, calls } = allServices()
    // The legacy host: without this deletion the arm below would pass for the version gate's reason
    // instead of the config's, which is exactly the confusion this arm exists to prevent.
    delete (services as Record<string, unknown>).tuiPanels
    /** A host double with every service composed. */
    const host = hostDouble(services)
    /** The report of a composition that disabled the takeover. */
    const report = mod.apply(host.ctx as never, { statusIntervalMs: 0, dashboardKey: false })
    expect(calls.views).toHaveLength(0)
    /** The skip's own record: `absent`, with the reason a reader needs. */
    const skipped = outcomeOf(report, "dashboardKey")
    expect(skipped.state).toBe("absent")
    expect(String(skipped.detail)).toContain("dashboardKey: false")
  })

  test("with the panel surface off, no panel is registered and both entry points keep the scene path", async () => {
    /** The recording services and the call log. */
    const { services, calls } = allServices()
    /** A host double with every service composed. */
    const host = hostDouble(services)
    /** The report of a composition that disabled the panel surface. */
    const report = mod.apply(host.ctx as never, { statusIntervalMs: 0, panel: false })
    expect(calls.panels).toHaveLength(0)
    /** The skip's own record: `absent`, naming the knob. */
    const skipped = outcomeOf(report, "panel")
    expect(skipped.state).toBe("absent")
    expect(String(skipped.detail)).toContain("panel: false")
    // `/mpd panel` still reaches a surface: the full-screen merged scene.
    /** The registered command handler. */
    const handler = calls.commands[0].handler as (invocation: unknown) => Promise<{ kind: string; text?: string }>
    expect((await handler({ rawInput: "panel" })).kind).toBe("success")
    expect(calls.scenes.some((entry: { open?: string }) => entry.open === "mpd-tui-subagents")).toBe(true)
  })

  test("every registered SCENE reports the host kit it received (the contact's arming path)", () => {
    // The take-over can only attach where a LIVE `useStdin` is reachable, and on dsh-tui 0.12.0 that
    // reachable one arrives with the kit a scene render receives (the module resolved at load answers
    // nothing). This arm therefore pins the WHOLE hand-off: `registerScene` threads the callback into
    // every factory, and every factory reports the kit it was handed.
    /** The kits the callback received, in call order. */
    const reported: unknown[] = []
    /** The scene descriptors the fake adapter captured, in registration order. */
    const registered: { id: string; component: unknown }[] = []
    /** The handle a registration returns; the scenes only read its `record`. */
    const handle = { record: () => {} }
    /** The fake adapter: only the four members `registerScene` touches. */
    const tui = {
      /** Fires the setup immediately, as a bound seam does, with a fake scene registry. */
      whenBound: (_key: string, setup: (service: unknown, scope: unknown, registration: typeof handle) => void) => {
        setup({ register: () => () => {} }, { scope: true }, handle)
        return { ...handle, outcome: () => ({ id: "tuiScenes", state: "requested" }), bound: () => true }
      },
      /** The bound scene registry, whose `register` is only checked for being callable. */
      scenes: () => ({ register: () => () => {} }),
      /** Records the descriptor; the handle methods are never used by this arm. */
      registerScene: (descriptor: { id: string; component: unknown }) => {
        registered.push(descriptor)
        return { ...handle, outcome: () => ({ id: "tuiScenes", state: "requested" }), bound: () => true, openScene: () => true, closeScene: () => false }
      },
      /** Scene opens are not part of this arm. */
      openScene: () => true,
    }
    /** A log double: the scenes only debug-log a refused open. */
    const log = { info: () => {}, warn: () => {}, debug: () => {} }
    registerScene(
      {} as never,
      tui as never,
      log,
      () => "/tmp/mpd-scenes",
      () => "/tmp/mpd-home",
      () => [],
      undefined,
      undefined,
      () => [],
      () => [],
      (ui: unknown) => {
        reported.push(ui)
        return true
      },
    )
    expect(registered.map((descriptor) => descriptor.id)).toEqual(["mpd-tui-board", "mpd-tui-team", "mpd-tui-plan", "mpd-tui-subagents"])
    /** The host kit double: identity-stable, and the hook the adapter is expected to remember. */
    const kit = sceneKitDouble()
    for (const descriptor of registered) {
      /** The scene component the factory built. */
      const component = descriptor.component as (props: unknown) => unknown
      // Each scene renders ONCE here. The arm is about the kit hand-off, which every factory performs
      // after the kit check and BEFORE its first read, so a body that later bails on the fake
      // workspace cannot mask it — and the report count below is asserted against the scene count.
      component({ React: kit.React, ui: kit.ui, close: () => {} })
    }
    expect(reported).toHaveLength(registered.length)
    for (const ui of reported) expect(ui).toBe(kit.ui)
  })
})

describe("honest outcomes (no disposer-type inference)", () => {
  test("a refused shortcut registration is reported refused, never confirmed", () => {
    /** The no-op disposer a refused registration returns. */
    const refusal = (): void => {}
    /** A host whose shortcut service refuses every combo. */
    const services = {
      tuiShortcuts: {
        register: () => refusal,
        list: () => [],
      },
    }
    /** The host double for that service set. */
    const host = hostDouble(services)
    /** The report `apply` returned. */
    const report = mod.apply(host.ctx as never, {})
    expect(outcomeOf(report, "tuiShortcuts").state).toBe("refused")
    /** The one aggregate diagnostic line. */
    const aggregate = host.infos.find((line) => line.includes("mpd TUI surfaces")) ?? ""
    expect(aggregate).toContain("tuiShortcuts(refused")
    expect(aggregate).not.toContain("tuiShortcuts(confirmed")
  })

  test("a refused renderer registration is reported requested, never confirmed", () => {
    /** A host whose renderer service answers with a no-op disposer. */
    const services = { tuiRenderers: { register: () => () => {} } }
    /** The host double for that service set. */
    const host = hostDouble(services)
    /** The report `apply` returned. */
    const report = mod.apply(host.ctx as never, {})
    expect(outcomeOf(report, "tuiRenderers").state).toBe("requested")
  })

  test("a panel host with no list() read-back is reported requested, never confirmed", () => {
    // The id is DISCOVERED from the host's own `list()`; without that read-back nothing proves the
    // registration, so the honest state is `requested` — exactly as the other unconfirmable seams.
    /** A host whose panel registry takes a registration but exposes no read-back. */
    const services = { tuiPanels: { register: () => () => {}, open: () => true } }
    /** The host double for that service set. */
    const host = hostDouble(services)
    /** The report `apply` returned. */
    const report = mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    /** The panel's own measured outcome. */
    const measured = outcomeOf(report, "panel")
    expect(measured.state).toBe("requested")
    expect(String(measured.detail)).toContain("no panel read-back")
  })

  test("a refused panel registration is reported refused, never confirmed", () => {
    /** A host whose panel registry refuses every descriptor by throwing. */
    const services = {
      tuiPanels: {
        register: () => {
          throw new Error("duplicate panel id")
        },
        list: () => [],
      },
    }
    /** The host double for that service set. */
    const host = hostDouble(services)
    /** The report `apply` returned. */
    const report = mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    /** The panel's own measured outcome. */
    const measured = outcomeOf(report, "panel")
    expect(measured.state).toBe("refused")
    expect(String(measured.detail)).toContain("duplicate panel id")
    /** The one aggregate diagnostic line names the refusal instead of hiding it. */
    const aggregate = host.infos.find((line) => line.includes("mpd TUI surfaces")) ?? ""
    expect(aggregate).toContain("tuiPanels(refused")
  })

  test("a refused panel OPEN falls back to the full-screen scene and prints the reason", async () => {
    // The frozen clause R4: `opened() === false` means the host refused (rate-limited, an id it no
    // longer owns, or no live panel consumer) — never a silent no-op, so the scene opens and the
    // printed line says which surface the user is looking at.
    /** The recording services and the call log. */
    const { services, calls } = allServices()
    /** The same services, with a panel registry that refuses every open request. */
    const refusalServices = {
      ...services,
      tuiPanels: { ...services.tuiPanels, open: () => false },
    }
    /** A host double for those services. */
    const host = hostDouble(refusalServices)
    mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    /** The registered command handler. */
    const handler = calls.commands[0].handler as (invocation: unknown) => Promise<{ kind: string; text?: string }>
    /** The `/mpd panel` answer. */
    const result = await handler({ rawInput: "panel" })
    expect(result.kind).toBe("success")
    expect(String(result.text)).toBe(t("panel.fallback", { id: "act0:team" }))
    // The refusal is not a no-op: the full-screen merged scene opened.
    expect(calls.scenes.some((entry: { open?: string }) => entry.open === "mpd-tui-subagents")).toBe(true)
  })

  test("C5: `/mpd dag` reaches the RICH scene — the one that draws the pin — not the bare one", async () => {
    // FROZEN CLAUSE C5, as an arm. The page's own `⤢` and the `/mpd dag` route must land the reader on a
    // surface with the SAME rich appearance as the page (frame/legend/keys/PIN). The two candidates differ
    // in exactly one of those four: `mpd-tui-team` draws the focused task's detail pane — the pin's
    // full-screen form — while `mpd-tui-subagents` draws the HOST's rows and no pin at all. A page whose
    // central gesture is click-to-pin must therefore open the former, and this arm pins which one it is
    // so a later re-aim cannot quietly hand the reader the poorer surface.
    /** The recording services and the call log. */
    const { services, calls } = allServices()
    /** A host with NO panel seam at all: the route then lands on the page's own full-screen surface. */
    const host = hostDouble({ ...services, tuiPanels: undefined })
    mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    /** The registered command handler. */
    const handler = calls.commands[0].handler as (invocation: unknown) => Promise<{ kind: string; text?: string }>
    /** The `/mpd dag` answer. */
    expect((await handler({ rawInput: "dag" })).kind).toBe("success")
    /** Every scene id this invocation opened. */
    const opened = calls.scenes.map((entry: { open?: string }) => entry.open)
    expect(opened).toContain(TEAM_SCENE_ID)
    // THE NEGATIVE HALF: the surface WITHOUT the pin is not what this route reaches. Without this the arm
    // would pass for a route that opened both scenes, which is a different defect.
    expect(opened).not.toContain(SUBAGENT_SCENE_ID)
  })

  test("an accepted panel OPEN prints the panel status line with the discovered id", async () => {
    /** The recording services and the call log. */
    const { services, calls } = allServices()
    /** A host double with every service composed (its panel registry accepts every open). */
    const host = hostDouble(services)
    mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    /** The registered command handler. */
    const handler = calls.commands[0].handler as (invocation: unknown) => Promise<{ kind: string; text?: string }>
    /** The `/mpd panel` answer. */
    const result = await handler({ rawInput: "panel" })
    expect(result.kind).toBe("success")
    // The id is the HOST's own `<pluginId>:<slug>`, discovered from `list()` — never composed here.
    expect(String(result.text)).toBe(t("panel.opened", { id: "act0:team" }))
    expect(calls.panelOpens).toEqual(["act0:team"])
    // …and the panel was the surface: no scene was opened for this invocation.
    expect(calls.scenes.some((entry: { open?: string }) => entry.open === "mpd-tui-subagents")).toBe(false)
    // `/mpd subagents` rides the same route.
    expect((await handler({ rawInput: "subagents" })).kind).toBe("success")
    expect(calls.panelOpens).toEqual(["act0:team", "act0:team"])
  })

  test("a missing decision grant with a no-op disposer is refused, and the disposer is not called as a probe", () => {
    /** How many times the decision disposer was called; it must stay 0. */
    let disposerCalls = 0
    /** A host whose grant facade denies every permission. */
    const services = {
      tuiPluginHost: {
        grants: { allows: () => false },
        subscribeDecision: () => () => {
          disposerCalls += 1
          return false
        },
      },
    }
    /** The host double for that service set. */
    const host = hostDouble(services)
    /** The report `apply` returned. */
    const report = mod.apply(host.ctx as never, {})
    expect(outcomeOf(report, "decisionEvents").state).toBe("refused")
    expect(outcomeOf(report, "decisionEvents").detail).toContain("no grant")
    // Calling the disposer would unregister a real handler — it is a cleanup,
    // never a probe.
    expect(disposerCalls).toBe(0)
    expect(host.warnings.filter((line) => line.includes("ready but NOT activated"))).toHaveLength(1)
  })

  test("a granted decision subscription is confirmed", () => {
    /** A host whose grant facade allows every permission. */
    const services = {
      tuiPluginHost: {
        grants: { allows: () => true },
        subscribeDecision: () => () => true,
      },
    }
    /** The host double for that service set. */
    const host = hostDouble(services)
    /** The report `apply` returned. */
    const report = mod.apply(host.ctx as never, {})
    expect(outcomeOf(report, "decisionEvents").state).toBe("confirmed")
    expect(host.warnings.filter((line) => line.includes("ready but NOT activated"))).toHaveLength(0)
  })

  test("without tuiPluginHost the seam is absent and no refusal is claimed", () => {
    /** A host with a status service and no `tuiPluginHost` at all. */
    const services = { tuiStatus: allServices().services.tuiStatus }
    /** The host double for that service set. */
    const host = hostDouble(services)
    /** The report `apply` returned. */
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
    /** The recording services and the call log. */
    const { services, calls } = allServices()
    /** The same services, with a picker that answers `status`. */
    const servicesWithPicker = {
      ...services,
      tuiDialogs: {
        ...services.tuiDialogs,
        /** The picker's answer: the status action. */
        async select(): Promise<string> {
          return "status"
        },
      },
    }
    /** The host double for those services. */
    const host = hostDouble(servicesWithPicker)
    mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    /** The registered command handler, called the way the harness calls it. */
    const handler = calls.commands[0].handler as (invocation: unknown) => Promise<{ kind: string; text?: string }>
    /** The handler's answer for the bare form. */
    const result = await handler({ rawInput: "", agent: {} })
    expect(result.kind).toBe("success")
    expect(String(result.text).startsWith("mpd:")).toBe(true)
  })

  test("bare /mpd falls back to the board when no dialog seam is composed", async () => {
    /** The recording services and the call log. */
    const { services, calls } = allServices()
    delete (services as Record<string, unknown>).tuiDialogs
    /** A host double with NO dialog service composed. */
    const host = hostDouble(services)
    mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    /** The registered command handler. */
    const handler = calls.commands[0].handler as (invocation: unknown) => Promise<{ kind: string }>
    expect((await handler({ rawInput: "", agent: {} })).kind).toBe("success")
    expect(calls.scenes.some((entry) => entry.open === "mpd-tui-board")).toBe(true)
  })

  test("direct actions and the unknown-action error", async () => {
    /** The recording services and the call log. */
    const { services, calls } = allServices()
    /** A host double with every service composed. */
    const host = hostDouble(services)
    mod.apply(host.ctx as never, { statusIntervalMs: 0 })
    /** The registered command handler. */
    const handler = calls.commands[0].handler as (invocation: unknown) => Promise<{ kind: string; text?: string }>
    /** A session double that accepts the log-only record. */
    const session = { append: () => {} }
    expect((await handler({ rawInput: " board ", agent: { session } })).kind).toBe("success")
    expect(calls.scenes.some((entry) => entry.open === "mpd-tui-board")).toBe(true)
    expect((await handler({ rawInput: "status" })).kind).toBe("success")
    expect((await handler({ rawInput: "workmates" })).kind).toBe("success")
    /** The handler's answer for an action outside the grammar. */
    const unknown = await handler({ rawInput: "nope" })
    expect(unknown.kind).toBe("error")
    expect(unknown.text).toContain(t("command.unknownAction", { action: "nope", usage: `/mpd [${COMMAND_ACTIONS.join("|")}]` }).split("{")[0].trim())
  })
})

describe("settings section disclosure (t21)", () => {
  test("every row names its mpd.jsonc key, and the SURFACE states the disclosure once", () => {
    // MEASURED (docker/ui, 2026-09-27): inlining the disclosure per row made 25 rows read as the
    // same four lines. The row keeps its key; the section states the rest, once.
    expect(SETTINGS_FIELDS.length).toBeGreaterThan(0)
    for (const field of SETTINGS_FIELDS) {
      expect(field.hint).toBeString()
      expect(field.hint).toContain("mpd.jsonc")
      expect(field.hint).not.toContain(BRIDGE_DISCLOSURE)
      expect(field.hint).not.toContain(BRIDGE_NOT_LOST)
    }
    expect(SECTION_NOTICE).toContain(BRIDGE_DISCLOSURE)
    expect(SECTION_NOTICE).toContain(BRIDGE_NOT_LOST)
    expect(String(SETTINGS_SECTION.descriptions?.zh)).toContain(BRIDGE_DISCLOSURE)
    expect(String(SETTINGS_SECTION.descriptions?.en)).toContain(BRIDGE_DISCLOSURE)
  })

  test("every slot hint LEADS with the knob's human sentence, then its key", () => {
    // The twelve team-model rows are the flat list's only rows with a human sentence: the label
    // carries the group (`槽位 2 提供商（分析型成员）`), the hint carries what the slot IS and what
    // configuring it DOES, and only then the mandatory key + disclosure + not-lost clause.
    const slotFields = SETTINGS_FIELDS.filter((field) => field.path[0] === "teamModels")
    expect(slotFields).toHaveLength(12)
    for (const field of slotFields) {
      /** The shared declaration this row must mirror. */
      const knob = SETTINGS_KNOBS.find((candidate) => [...candidate.path].join(".") === field.path.join("."))
      expect(knob).toBeDefined()
      expect(field.label).toBe(knob!.label)
      expect(field.label).toContain(String(TEAM_MODEL_SLOT_GROUPS[field.path[1] as "slot1"].en))
      expect(field.descriptions?.zh).toBe(knob?.zh)
      expect(field.descriptions?.zh).toContain(String(TEAM_MODEL_SLOT_GROUPS[field.path[1] as "slot1"].zh))
      // human sentence FIRST
      expect(field.hint!.startsWith(String(knob?.semantics))).toBe(true)
      // ...then the dotted key — and NOT the surface's disclosure (stated once, above the rows)
      expect(field.hint).toContain(`mpd.jsonc ${field.path.join(".")}`)
      expect(field.hint).not.toContain(BRIDGE_DISCLOSURE)
      expect(field.hint).not.toContain(BRIDGE_NOT_LOST)
      expect(field.hint!.indexOf(`mpd.jsonc ${field.path.join(".")}`)).toBeGreaterThan(String(knob?.semantics).length - 1)
      // the sentence names THIS slot's members, in the group's own order
      expect(field.hint).toContain(teamModelMembers(field.path[1] as "slot1", "en"))
      // R4, the host's OWN pattern (captain's A2): `hint` is the ENGLISH base and
      // `hintDescriptions` carries the zh translation — never an `en` twin of the base, which the
      // host's `pick(field.hint, field.hintDescriptions)` would only duplicate. The zh half must
      // carry the same dotted key, or a zh reader loses the pointer the disclosure hangs off.
      expect(field.hintDescriptions).toBeDefined()
      expect(Object.keys(field.hintDescriptions!)).toEqual(["zh"])
      expect(field.hintDescriptions!.zh).toContain(`mpd.jsonc ${field.path.join(".")}`)
      expect(field.hintDescriptions!.zh).toContain(String(knob?.semanticsZh))
      expect(field.hintDescriptions!.zh).not.toBe(field.hint)
    }
    expect(String(slotFields[3].hint)).toContain("analysis members (Researcher, Explorer, Plan Reviewer)")
    expect(String(slotFields[3].hint)).not.toContain("Architect")
    expect(String(slotFields[3].hint)).toContain("Vision Analyst")
    // the thirteen scalar rows carry their key alone (they have no invented copy), and — having no
    // zh sentence to translate — no `hintDescriptions` either: the host falls back to the base.
    for (const field of SETTINGS_FIELDS.filter((candidate) => candidate.path[0] !== "teamModels")) {
      expect(field.hint).toBe(`mpd.jsonc ${field.path.join(".")}`)
      expect(field.hintDescriptions).toBeUndefined()
    }
  })

  test("R4: the localized pairs are the host's OWN shape — an `en` base, never a redundant `en` twin", () => {
    // A2: `descriptions: { zh }` with the English in the base field is the host's own declaration
    // pattern. An `en` key duplicating the base buys nothing and doubles the surface a reviewer
    // has to check, so its presence is asserted ABSENT rather than tolerated.
    for (const field of SETTINGS_FIELDS) {
      expect(field.descriptions).toBeDefined()
      expect(Object.keys(field.descriptions!)).toEqual(["zh"])
      // Every field's English base is present and non-empty, which is what makes the zh-only map
      // safe: a language the map does not cover falls back to these.
      expect(field.label.length).toBeGreaterThan(0)
      expect(String(field.hint).length).toBeGreaterThan(0)
    }
    // The slot knobs' base labels carry the EN group name and their zh labels the zh one, so both
    // languages are genuinely reachable rather than one being a copy of the other.
    for (const field of SETTINGS_FIELDS.filter((candidate) => candidate.path[0] === "teamModels")) {
      /** The shared declaration this row mirrors. */
      const knob = SETTINGS_KNOBS.find((candidate) => [...candidate.path].join(".") === field.path.join("."))
      expect(field.label).toBe(knob!.label)
      // The two languages genuinely differ: the base is the EN sentence, the map the zh one.
      expect(String(field.hint)).not.toBe(field.hintDescriptions!.zh)
      expect(String(field.hint).startsWith(String(knob!.semantics))).toBe(true)
      expect(String(field.hintDescriptions!.zh).startsWith(String(knob!.semanticsZh))).toBe(true)
    }
    // The SECTION's own localized text rides `descriptions` (there is no section hint field), and
    // its English base is the title, so a language the map misses shows the title rather than a key.
    expect(SETTINGS_SECTION.title).toBe("MPD bundle")
    expect(Object.keys(SETTINGS_SECTION.descriptions!).sort()).toEqual(["en", "zh"])
    expect(String(SETTINGS_SECTION.descriptions!.en).startsWith(SETTINGS_SECTION.title)).toBe(true)
  })

  test("the registered section's 22 rows mirror the declaration: labels, zh, and human-first hints", async () => {
    /** The call log, after the catalog read settled. */
    const { calls } = await applyWithAdapter(async () => ({ providers: [], degraded: true }))
    /** The one registered section. */
    const section = calls.sections[0]
    expect(section.fields).toHaveLength(SETTINGS_KNOBS.length)
    for (const [index, field] of section.fields.entries()) {
      /** The shared declaration at the same index. */
      const knob = SETTINGS_KNOBS[index]
      expect([...(field.path as string[])]).toEqual([...knob.path])
      expect(field.label).toBe(knob.label)
      expect(field.descriptions?.zh).toBe(knob.zh)
      expect(String(field.hint).startsWith(knob.semantics ?? `mpd.jsonc ${knob.path.join(".")}`)).toBe(true)
      expect(field.hint).toContain(`mpd.jsonc ${knob.path.join(".")}`)
      // the disclosure is the SURFACE's, once — never the row's
      expect(field.hint).not.toContain(BRIDGE_DISCLOSURE)
      expect(field.hint).not.toContain(BRIDGE_NOT_LOST)
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
    /** A board projection of the process cwd, with no live session. */
    const state = readBoardState(process.cwd(), process.env.HOME ?? process.cwd())
    expect(statusLine(state)).not.toContain(NO_LIVE_SESSION_NOTICE)
    /** The same line with the no-live-session notice appended. */
    const withNotice = statusLine(state, NO_LIVE_SESSION_NOTICE)
    expect(withNotice).toContain(NO_LIVE_SESSION_NOTICE)
    expect(withNotice.startsWith("mpd:")).toBe(true)
    // the counts survive in front of the notice
    expect(withNotice.indexOf("plans ")).toBeLessThan(withNotice.indexOf(NO_LIVE_SESSION_NOTICE))
  })

  test("the status line publishes the notice only while the last write-back was skipped for no-live-session", () => {
    /** A composition whose last write-back was skipped for no live session. */
    const notLive = allServices({ mpdConfig: { states: () => ({ files: [], errors: [], writeback: { skipped: "no-live-session", writtenTo: [], applies: "restart" } }) } })
    mod.apply(hostDouble(notLive.services).ctx as never, { statusIntervalMs: 0 })
    /** The contributions published for that composition. */
    const published = notLive.calls.statusSet.filter((entry: any) => entry.key === STATUS_KEY)
    expect(published.length).toBeGreaterThan(0)
    expect(String(published.at(-1).text)).toContain(NO_LIVE_SESSION_NOTICE)

    // an ambiguous-multi-root refusal gets its OWN sentence (settings-only, candidates in the log)
    const other = allServices({ mpdConfig: { states: () => ({ files: [], errors: [], writeback: { skipped: "ambiguous-multi-root", writtenTo: [], applies: "restart" } }) } })
    mod.apply(hostDouble(other.services).ctx as never, { statusIntervalMs: 0 })
    /** The contributions published for the ambiguous-target composition. */
    const otherPublished = other.calls.statusSet.filter((entry: any) => entry.key === STATUS_KEY)
    expect(otherPublished.length).toBeGreaterThan(0)
    expect(String(otherPublished.at(-1).text)).toContain(AMBIGUOUS_MULTI_ROOT_NOTICE)
    expect(String(otherPublished.at(-1).text)).not.toContain("no live session")

    // and a successful write-back clears it again
    const cleared = allServices({ mpdConfig: { states: () => ({ files: [], errors: [], writeback: { writtenTo: ["/ws/.mpd/mpd.jsonc"], results: [], applies: "restart" } }) } })
    mod.apply(hostDouble(cleared.services).ctx as never, { statusIntervalMs: 0 })
    /** The contributions published after a successful write-back. */
    const clearedPublished = cleared.calls.statusSet.filter((entry: any) => entry.key === STATUS_KEY)
    expect(String(clearedPublished.at(-1).text)).not.toContain("no live session")
  })
})
