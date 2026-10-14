// AC1 + AC3 of the model-config-live-refresh wave (fix/model-config-live-refresh): the
// ENTRY-CONFIG live refresh (a save to the `mpd-config` entry document re-loads `state` with no
// reload call, R1) and the `agentRoutes` precedence chain with its loud validation (R2).
//
// The harness is the ADAPTER SEAM, keyed by namespace: unlike the legacy wiring double (which
// keeps ONE listener), this one records a listener PER ns, because the row now subscribes TWO
// documents — the legacy `mpd` namespace and the `mpd-config` entry — and the case must fire the
// ENTRY listener while proving the legacy one still works.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, agentRouteEntryOfMember, teamModelRouteOfMember, Config } from "../src/index"
import { AGENT_ROUTES_SCHEMA, ROSTER_AGENT_NAMES, SettingsSchema, TEAM_MODEL_SLOT_DEFAULTS } from "../src/settings-schema"

/** Temp paths created by this file's fixtures, drained by the shared `afterEach` so no run leaks state. */
const temps: string[] = []

/**
 * Build one isolated workspace: its root and the `.mpd/mpd.jsonc` path under it.
 *
 * @returns the workspace root and the project-file path (the file is NOT created here).
 */
function sandbox(): { root: string; file: string } {
  /** Unique throwaway directory; `mkdtempSync` is what keeps two fixtures from colliding. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-live-refresh-"))
  temps.push(dir)
  /** The workspace subdirectory, so a case never writes at the temp root. */
  const root = join(dir, "ws")
  mkdirSync(join(root, ".mpd"), { recursive: true })
  return { root, file: join(root, ".mpd", "mpd.jsonc") }
}

// Every fixture directory is removed after each case, and the bridge env lever is unset so one
// case's `MPD_DSH_TUI_SETTINGS_BRIDGE` cannot leak into the next.
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env.MPD_DSH_TUI_SETTINGS_BRIDGE
})

/** How long a watcher case waits for the 150ms debounce plus the reload it triggers. */
const WATCH_SETTLE_MS = 400

/**
 * Yield for `ms` milliseconds, so a watcher's debounce and its async reload can run.
 *
 * @param ms - the wall-clock budget to give the row's timer.
 * @returns a promise that settles after that budget.
 */
function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

/** The knobs a live-refresh case may set on the fake adapter before the row is applied. */
interface HarnessOptions {
  /** Live session workspaces the adapter reports. */
  roots?: string[]
  /**
   * The ENTRY-CONFIG document's RESOLVED `value`: the apply-time fiber config. MEASURED on harness
   * 0.1.7-rc.2, `settings/mutate` never moves it, so the double keeps it FROZEN for the whole case.
   */
  entryValue?: any
  /** The entry document's `user` OVERRIDE section — exactly the leaves a save (or profile patch) set. */
  entrySaved?: any
  /** The entry document's `base` inherited layer, BELOW the override; a save never moves it either. */
  entryBase?: any
  /** The legacy `mpd` namespace's raw user section, when a case needs the bridge path too. */
  user?: any
}

/**
 * The ns-KEYED adapter-seam double: it serves both settings documents (`mpd` and `mpd-config`),
 * records one `settings/document-updated` listener PER NAMESPACE, and hands the row an `mpdDsh`
 * service — so a failure names the seam the row actually used.
 *
 * The entry document mimics the MEASURED host split (harness 0.1.7-rc.2): a save moves the OVERRIDE
 * half (`user`) while the RESOLVED `value` keeps projecting the apply-time fiber config and `base`
 * stays the inherited layer under the override. A case that composed its layer from `value` would
 * therefore read stale knobs here exactly as it does on the real host.
 *
 * @param options - the case's initial documents and live roots.
 * @returns the ctx, the provided services, the per-ns emitters and the recorded registrations.
 */
function harness(options: HarnessOptions = {}): {
  /** The cordis context handed to `apply`. */
  ctx: Parameters<typeof apply>[0]
  /** Services the row provided, keyed by name (`mpdConfig` is the one under test). */
  provided: Record<string, any>
  /** Emulate a SAVE: move the entry document's OVERRIDE half (`user`) — never the frozen `value`. */
  saveEntry: (value: any) => void
  /** Replace the LEGACY namespace's raw user section — the retired front door's save. */
  setLegacyUser: (section: any) => void
  /** Fire the ENTRY document's update event (revision bumped), i.e. what a settings save emits. */
  emitEntry: () => void
  /** Fire the LEGACY namespace's update event, so a case can prove the two paths stay separate. */
  emitLegacy: (source?: string) => void
  /** Disposers the row registered through `ctx.effect`, with the label each registered under. */
  effects: { label: string | undefined; dispose: () => void }[]
} {
  /** Live workspaces the adapter reports; empty means no session has a workspace. */
  const roots = options.roots ?? []
  /** The entry document's FROZEN resolved value (the apply-time fiber config); a save never moves it. */
  const entryValue = options.entryValue ?? {}
  /** The entry document's OVERRIDE half (`describe().user`), which every emulated save rewrites. */
  let entrySaved = options.entrySaved ?? {}
  /** The entry document's inherited half (`describe().base`), under the override; a save never moves it. */
  const entryBase = options.entryBase ?? {}
  /** The legacy namespace's raw user section. */
  let userSection = options.user
  /** Current revision per document, bumped by every emulated save. */
  const revisions: Record<string, number> = { "mpd": 1, "mpd-config": 1 }
  /** The row's listeners, keyed by the namespace each subscribed. */
  const listeners = new Map<string, (revision?: number, source?: string) => void>()
  /** Services published through the context stub. */
  const provided: Record<string, any> = {}
  /** Disposers the row registered, in registration order. */
  const effects: { label: string | undefined; dispose: () => void }[] = []
  /** The fake `mpdDsh` service: each member mirrors one adapter seam the row is allowed to call. */
  const adapter = {
    settingsRegister: () => ({ ok: true }),
    workspaceRoot: (exec?: any) => exec?.agent?.session?.header?.cwd ?? roots[0] ?? "/nonexistent-mount-root",
    workspaceRootsAll: () => [...roots],
    settingsReader: (ns: string) =>
      ns === "mpd"
        ? { get: () => userSection, describe: () => userSection === undefined ? undefined : { value: userSection, revision: revisions["mpd"], user: userSection, base: {}, applies: "restart" } }
        : ns === "mpd-config"
          ? { get: () => entrySaved, describe: () => ({ value: entryValue, revision: revisions["mpd-config"], user: entrySaved, base: entryBase, applies: "restart" }) }
          : undefined,
    onSettingsDocumentUpdated: (ns: string, listener: (revision?: number, source?: string) => void) => {
      listeners.set(ns, listener)
      return () => { listeners.delete(ns) }
    },
    settingsMutate: async () => ({ ok: true }),
    registerTool: () => () => { /* a case never drives tools through this double */ },
  }
  /** The context `apply` receives; untyped because the double implements only the seams the row uses. */
  const ctx: any = {
    get: (serviceName: string) => (serviceName === "mpdDsh" ? adapter : undefined),
    provide: (serviceName: string, value: any) => { provided[serviceName] = value },
    logger: { warn: () => { /* logged lines are not this file's subject */ } },
    effect: (callback: () => unknown, label?: string) => {
      /** Whatever the callback registered: a disposer when it returned one. */
      const disposer = callback()
      if (typeof disposer === "function") effects.push({ label, dispose: disposer as () => void })
      return typeof disposer === "function" ? disposer : () => { /* nothing to dispose */ }
    },
  }
  return {
    ctx,
    provided,
    saveEntry: (value: any) => { entrySaved = value },
    setLegacyUser: (section: any) => { userSection = section },
    emitEntry: () => { revisions["mpd-config"] += 1; listeners.get("mpd-config")?.(revisions["mpd-config"], "update") },
    emitLegacy: (source?: string) => { revisions["mpd"] += 1; listeners.get("mpd")?.(revisions["mpd"], source) },
    effects,
  }
}

describe("AC1 — an entry-config save refreshes state with NO reload call (R1)", () => {
  test("a save to the mpd-config entry document is what the NEXT service read answers", () => {
    /** Sole live workspace, so the entry refresh resolves against a real root. */
    const { root } = sandbox()
    /** Fake adapter whose entry document starts UNSET (the apply-time row config stands). */
    const h = harness({ roots: [root] })
    apply(h.ctx)
    /** The service under test, read BEFORE any save: the slot's built-in default. */
    const service = h.provided.mpdConfig
    expect(service.get("teamModels.slot3.model")).toBe(TEAM_MODEL_SLOT_DEFAULTS.slot3.model)
    // THE SAVE: both front doors write the ENTRY document (`configForms.get("mpd-config")`, the
    // TUI's `locateNamespace` default) — this is the path the retired-namespace world travels.
    h.saveEntry({ teamModels: { slot3: { provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "low" } } })
    h.emitEntry()
    // AC1: the new value is live WITHOUT any `mpd_config_reload` call — the subscription re-loaded state.
    expect(service.get("teamModels.slot3.model")).toBe("deepseek-v4-pro")
    expect(service.get("teamModels.slot3.reasoningEffort")).toBe("low")
    // A LEAF the save did not touch keeps its layer: slot1 is still the default, not wiped.
    expect(service.get("teamModels.slot1")).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot1)
  })

  test("an agentRoutes save through the entry document routes the member on the NEXT read", () => {
    /** Sole live workspace, so the entry refresh resolves against a real root. */
    const { root } = sandbox()
    /** Fake adapter whose entry document starts UNSET. */
    const h = harness({ roots: [root] })
    apply(h.ctx)
    /** The service under test. */
    const service = h.provided.mpdConfig
    expect(service.teamModelRouteOf("Deep Worker")).toEqual({ provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" })
    // The save: an `agentRoutes` entry for Deep Worker through the ENTRY document.
    h.saveEntry({ agentRoutes: { "Deep Worker": { provider: "gateway", model: "deepseek-v4-pro" } } })
    h.emitEntry()
    expect(service.teamModelRouteOf("Deep Worker")).toEqual({ provider: "gateway", model: "deepseek-v4-pro", reasoningEffort: "high" })
  })

  test("the entry refresh SURVIVES a later tool reload (the override is not reverted to the apply-time config)", async () => {
    /** Sole live workspace; its file exists so a reload has something to re-read. */
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 3 } }\n`)
    /** Fake adapter whose entry document starts UNSET. */
    const h = harness({ roots: [root] })
    apply(h.ctx)
    h.saveEntry({ ulw: { maxRounds: 9 } })
    h.emitEntry()
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(9)
    // A tool's `reload(exec)` re-reads every layer — the FRESH entry knobs must still be the L4
    // layer, or the reload would silently revert the save to the apply-time row config.
    h.provided.mpdConfig.reload({ agent: { session: { header: { cwd: root } } } })
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(9)
  })

  test("the legacy mpd-namespace listener still fires beside the entry one (extend, not replace)", () => {
    /** Sole live workspace; its file receives the legacy bridge's write-back. */
    const { root, file } = sandbox()
    /** Fake adapter serving BOTH documents, with one leaf already saved on the legacy namespace. */
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 2 } } })
    apply(h.ctx)
    // A save on the LEGACY namespace document still runs the bridge path (state re-load + file
    // write-back) — the two subscriptions coexist, each on its own document.
    h.setLegacyUser({ ulw: { maxRounds: 3 } })
    h.saveEntry({ ulw: { maxRounds: 9 } })
    h.emitEntry()
    h.emitLegacy("update")
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(9)
    expect(readFileSync(file, "utf8")).toContain('"maxRounds": 3')
    // And the entry save survived the legacy save's own state re-load (both layers in force).
    expect(h.provided.mpdConfig.states().settings.namespace).toBe("mpd")
  })

  test("R1's file half: a HAND edit of .mpd/mpd.jsonc reaches state through the MOUNT-ARMED watcher", async () => {
    /** Sole live workspace, whose file pre-exists so the mount-time watcher has a directory. */
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 3 } }\n`)
    /** Fake adapter with NO save of any kind — pre-wave, this mount armed NO watcher at all. */
    const h = harness({ roots: [root] })
    apply(h.ctx)
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(3)
    // A hand edit (no settings save, no write-back, no reload call): only the mount-armed
    // project-file watcher can observe it — the 150ms debounce reloads state.
    writeFileSync(file, `{ "ulw": { "maxRounds": 42 } }\n`)
    await wait(WATCH_SETTLE_MS)
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(42)
    // The watcher is a row-scoped resource: it registered a disposer under the row's own effect.
    expect(h.effects.some((registered) => (registered.label ?? "").includes(file))).toBe(true)
  })

  test("a MATERIALISED default in the entry document never becomes L4: a file edit still wins (measured host)", async () => {
    /** Sole live workspace, whose file carries a knob the entry document also materialises. */
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 3 } }\n`)
    // The measured host split: the resolved VALUE and the inherited BASE both still carry their
    // materialised defaults while the OVERRIDE half (`user`) is the only saved layer — empty here.
    const h = harness({ roots: [root], entryValue: { ulw: { maxRounds: 9 } }, entryBase: { ulw: { maxRounds: 7 } } })
    apply(h.ctx)
    // The fixture is NOT vacuous: the stale halves really do carry their numbers.
    /** The entry descriptor the double serves, read back so the fixture's own staleness is asserted. */
    const entryDescriptor = h.ctx.get?.("mpdDsh")?.settingsReader?.("mpd-config")?.describe()
    expect(entryDescriptor?.value).toEqual({ ulw: { maxRounds: 9 } })
    expect(entryDescriptor?.base).toEqual({ ulw: { maxRounds: 7 } })
    // The mount read applies the FILE's 3 — neither stale number may sit above it as L4.
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(3)
    // A hand edit moves the file, then the entry event re-reads the document: a composition that took
    // `value` (9) or `base` (7) would bury BOTH file values; only the empty override leaves 42.
    writeFileSync(file, `{ "ulw": { "maxRounds": 42 } }\n`)
    await wait(WATCH_SETTLE_MS)
    h.emitEntry()
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(42)
  })
})

describe("AC3 — agentRoutes beats the slot beats the default; validation is loud (R2)", () => {
  test("the vocabulary is the roster's eleven base names, derived from the slot groups", () => {
    expect(ROSTER_AGENT_NAMES).toEqual([
      "Architect", "Planner", "Reviewer", "Lead", "Senior Engineer",
      "Researcher", "Explorer", "Plan Reviewer",
      "Deep Worker", "Junior Engineer",
      "Vision Analyst",
    ])
  })

  test("agentRoutes[name] beats teamModels.slot{N} beats the built-in default, per leaf", () => {
    // agentRoutes > DEFAULT (no explicit slot): the entry wins wholly.
    expect(teamModelRouteOfMember("Deep Worker", { agentRoutes: { "Deep Worker": { provider: "gateway", model: "gpt-x", reasoningEffort: "low" } } }))
      .toEqual({ provider: "gateway", model: "gpt-x", reasoningEffort: "low" })
    // agentRoutes > EXPLICIT slot: the entry wins even against a configured slot.
    expect(teamModelRouteOfMember("Deep Worker", {
      teamModels: { slot3: { provider: "slot-provider", model: "slot-model", reasoningEffort: "off" } },
      agentRoutes: { "Deep Worker": { provider: "route-provider", model: "route-model" } },
    })).toEqual({ provider: "route-provider", model: "route-model", reasoningEffort: "off" })
    // PARTIAL entry: an unset leaf falls through to the slot's leaf (the per-field precedence).
    expect(teamModelRouteOfMember("Deep Worker", {
      teamModels: { slot3: { provider: "slot-provider", model: "slot-model", reasoningEffort: "off" } },
      agentRoutes: { "Deep Worker": { model: "route-model" } },
    })).toEqual({ provider: "slot-provider", model: "route-model", reasoningEffort: "off" })
    // slot{N} > default without any entry: the pre-existing precedence stands unchanged.
    expect(teamModelRouteOfMember("Deep Worker", { teamModels: { slot3: { provider: "slot-provider", model: "slot-model" } } }))
      .toEqual({ provider: "slot-provider", model: "slot-model", reasoningEffort: "high" })
    expect(teamModelRouteOfMember("Deep Worker", {})).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot3)
    // An EMPTY entry is inert ({} = no override), never an error.
    expect(teamModelRouteOfMember("Deep Worker", { agentRoutes: { "Deep Worker": {} } })).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot3)
    // A non-roster member is still not slot-routed at all.
    expect(teamModelRouteOfMember("not-a-roster-member", { agentRoutes: { "Deep Worker": { model: "x" } } })).toBeUndefined()
  })

  test("a malformed entry fails the read LOUDLY, naming the member (hand-edited files have no schema)", () => {
    // A non-object entry is the loudest class: the value cannot be a route at all.
    expect(() => teamModelRouteOfMember("Deep Worker", { agentRoutes: { "Deep Worker": "deepseek-v4-pro" } })).toThrow(/agentRoutes\.Deep Worker/)
    // An unknown leaf is rejected, never silently ignored.
    expect(() => teamModelRouteOfMember("Deep Worker", { agentRoutes: { "Deep Worker": { provider: "p", modal: "typo" } } })).toThrow(/unknown leaf "modal"/)
    // A non-string leaf is rejected with its own name.
    expect(() => teamModelRouteOfMember("Deep Worker", { agentRoutes: { "Deep Worker": { model: 7 } } })).toThrow(/agentRoutes\.Deep Worker\.model/)
    // The guard is reachable through the entry reader alone (the exported half of the validation).
    expect(agentRouteEntryOfMember("Vision Analyst", { agentRoutes: { "Vision Analyst": { model: "deepseek-v4-flash-vision-exp" } } })).toEqual({ model: "deepseek-v4-flash-vision-exp" })
    // A member with no entry resolves to an EMPTY entry — distinguishable from "no table".
    expect(agentRouteEntryOfMember("Lead", { agentRoutes: { "Deep Worker": { model: "x" } } })).toEqual({})
  })

  test("the SCHEMA rejects an unknown agent name loudly — namespace and row config both", () => {
    // The settings-namespace schema: an unknown NAME is a validation error, never a silent drop.
    expect(() => (SettingsSchema as any)({ agentRoutes: { "Bogus Agent": { model: "deepseek-v4-pro" } } })).toThrow()
    // The ROW CONFIG schema (what the loader validates the patch row and the settings editor
    // validates a save against) inherits the same key union through the shared knob dict.
    expect(() => (Config as any)({ agentRoutes: { "bogus": { model: "deepseek-v4-pro" } } })).toThrow()
    // A malformed ENTRY value is equally loud at schema time.
    expect(() => (SettingsSchema as any)({ agentRoutes: { "Deep Worker": "deepseek-v4-pro" } })).toThrow()
    expect(() => (SettingsSchema as any)({ agentRoutes: { "Deep Worker": { model: 7 } } })).toThrow()
    // The healthy table resolves: entries kept verbatim, absent names absent.
    expect((SettingsSchema as any)({ agentRoutes: { "Deep Worker": { model: "deepseek-v4-pro" } } }).agentRoutes).toEqual({ "Deep Worker": { model: "deepseek-v4-pro" } })
    expect((SettingsSchema as any)({}).agentRoutes).toEqual({})
    // The standalone knob schema carries the same contract (the exported declaration under test).
    expect(() => (AGENT_ROUTES_SCHEMA as any)({ "Not A Member": {} })).toThrow()
    expect((AGENT_ROUTES_SCHEMA as any)({ "Plan Reviewer": { reasoningEffort: "max" } })).toEqual({ "Plan Reviewer": { reasoningEffort: "max" } })
  })

  test("the mpd_config_get tool's consumed-keys disclosure names agentRoutes", () => {
    /** Every tool the row registered, captured by a minimal ctx the reader can walk. */
    const registered: any[] = []
    apply({ tools: { register: (t: any) => registered.push(t) }, provide: () => { /* no service needed here */ } } as any, {})
    /** The config-read tool, whose description is the knob surface's own documentation. */
    const tool = registered.find((t) => t.name === "mpd_config_get")
    expect(String(tool.description)).toContain("agentRoutes")
  })
})
