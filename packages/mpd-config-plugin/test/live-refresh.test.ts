// AC1 + AC3 of the model-config-live-refresh wave (fix/model-config-live-refresh), re-aimed by the
// slot-single-source contract: the ENTRY-CONFIG live refresh (a save to the `mpd-config` entry
// document re-loads `state` with no reload call, R1) and the ONE-configured-route-per-slot rule
// with its TYPED, never-throwing resolution (contract `.mpd/plans/slot-single-source.md` §1-§9,
// amendment 1).
//
// The harness is the ADAPTER SEAM, keyed by namespace: unlike the legacy wiring double (which
// keeps ONE listener), this one records a listener PER ns, because the row now subscribes TWO
// documents — the legacy `mpd` namespace and the `mpd-config` entry — and the case must fire the
// ENTRY listener while proving the legacy one still works.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, resolveTeamModelSlot, teamModelRouteOfMember } from "../src/index"

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
    /** The service under test, read BEFORE any save: nothing is configured, and nothing is invented. */
    const service = h.provided.mpdConfig
    expect(service.get("teamModels")).toBeUndefined()
    // THE SAVE: both front doors write the ENTRY document (`configForms.get("mpd-config")`, the
    // TUI's `locateNamespace` default) — this is the path the retired-namespace world travels.
    h.saveEntry({ teamModels: { slot3: { provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "low" } } })
    h.emitEntry()
    // AC1: the new value is live WITHOUT any `mpd_config_reload` call — the subscription re-loaded state.
    expect(service.get("teamModels.slot3.model")).toBe("deepseek-v4-pro")
    expect(service.get("teamModels.slot3.reasoningEffort")).toBe("low")
    // A slot the save did not touch stays ABSENT — no default layer fills it in (contract §2).
    expect(service.get("teamModels.slot1")).toBeUndefined()
  })

  test("a teamModels save through the entry document routes the member on the NEXT read", () => {
    /** Sole live workspace, so the entry refresh resolves against a real root. */
    const { root } = sandbox()
    /** Fake adapter whose entry document starts UNSET. */
    const h = harness({ roots: [root] })
    apply(h.ctx)
    /** The service under test. */
    const service = h.provided.mpdConfig
    // Before the save the member has NO route: undefined, never a built-in one (amendment 1).
    expect(service.teamModelRouteOf("Deep Worker")).toBeUndefined()
    expect(service.slotResolutionOf("Deep Worker")).toMatchObject({ ok: false, status: "unconfigured", slot: "slot3" })
    // The save: the slot that routes Deep Worker, fully configured, through the ENTRY document.
    h.saveEntry({ teamModels: { slot3: { provider: "gateway", model: "deepseek-v4-pro", reasoningEffort: "low" } } })
    h.emitEntry()
    expect(service.teamModelRouteOf("Deep Worker")).toEqual({ provider: "gateway", model: "deepseek-v4-pro", reasoningEffort: "low" })
    expect(service.slotResolutionOf("Deep Worker")).toMatchObject({ ok: true, slot: "slot3", route: { provider: "gateway", model: "deepseek-v4-pro", reasoningEffort: "low" } })
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

describe("AC3 — ONE configured route per slot; the deleted layers stay deleted (contract §2-§9)", () => {
  test("a configured slot resolves to exactly its own route, for every member it routes", () => {
    /** One fully configured slot3, the slot both executors share. */
    const config = { teamModels: { slot3: { provider: "gateway", model: "gpt-x", reasoningEffort: "low" } } }
    expect(resolveTeamModelSlot("Deep Worker", config)).toEqual({
      ok: true,
      slot: "slot3",
      route: { provider: "gateway", model: "gpt-x", reasoningEffort: "low" },
      fallbacks: [],
      fallbacksDropped: 0,
    })
    // BOTH members of the group resolve through the SAME slot — the membership is one declaration.
    expect(teamModelRouteOfMember("Junior Engineer", config)).toEqual({ provider: "gateway", model: "gpt-x", reasoningEffort: "low" })
    // A slot that states NO effort yields no effort: none is invented, none is defaulted.
    expect(teamModelRouteOfMember("Junior Engineer", { teamModels: { slot3: { provider: "p", model: "m" } } })).toEqual({ provider: "p", model: "m" })
  })

  test("an absent slot is TYPED unconfigured — the resolver and the service never throw (amendment 1)", () => {
    /** The total resolution of a member whose slot the workspace never declared. */
    const resolution = resolveTeamModelSlot("Deep Worker", {})
    expect(resolution.ok).toBe(false)
    if (resolution.ok || resolution.status === "unrouted") throw new Error("unreachable: the slot was not configured")
    expect(resolution.status).toBe("unconfigured")
    expect(resolution.slot).toBe("slot3")
    expect(resolution.members).toEqual(["Deep Worker", "Junior Engineer"])
    expect(resolution.missing).toEqual(["provider", "model"])
    expect(resolution.code).toBe("SLOT_UNCONFIGURED")
    // ONE structured failure: the slot, its members, both recovery paths, and the no-side-effect claim.
    expect(resolution.message).toContain("SLOT_UNCONFIGURED")
    expect(resolution.message).toContain("teamModels.slot3.provider")
    expect(resolution.message).toContain("teamModels.slot3.model")
    expect(resolution.message).toContain("/mpd-model")
    expect(resolution.message).toContain(".mpd/mpd.jsonc")
    expect(resolution.message).toContain("nothing was written and no child was started")
    // The TOTAL route read answers undefined for it — a display path must never see an exception.
    expect(teamModelRouteOfMember("Deep Worker", {})).toBeUndefined()
  })

  test("model-without-provider is unconfigured, naming ONLY the missing leaf", () => {
    /** A slot that states a model but no provider. */
    const resolution = resolveTeamModelSlot("Researcher", { teamModels: { slot2: { model: "m" } } })
    expect(resolution.ok).toBe(false)
    if (resolution.ok || resolution.status === "unrouted") throw new Error("unreachable: the slot has no provider")
    expect(resolution.status).toBe("unconfigured")
    expect(resolution.missing).toEqual(["provider"])
    expect(resolution.message).toContain("teamModels.slot2.provider")
    expect(resolution.message).not.toContain("teamModels.slot2.model")
  })

  test("a malformed leaf is `invalid`, naming its path — and still never throws", () => {
    /** A slot whose model leaf is a number, which no route can use. */
    const resolution = resolveTeamModelSlot("Vision Analyst", { teamModels: { slot4: { provider: "p", model: 7 } } })
    expect(resolution.ok).toBe(false)
    if (resolution.ok || resolution.status === "unrouted") throw new Error("unreachable: the model leaf is malformed")
    expect(resolution.status).toBe("invalid")
    expect(resolution.problem).toBe("teamModels.slot4.model")
    expect(resolution.message).toContain("must be a string")
    // A slot that is not an object at all is `invalid` too, and the sentence names the key.
    const notObject = resolveTeamModelSlot("Vision Analyst", { teamModels: { slot4: "deepseek-v4-flash" } })
    expect(notObject.ok).toBe(false)
    if (notObject.ok || notObject.status === "unrouted") throw new Error("unreachable: the slot value is not an object")
    expect(notObject.status).toBe("invalid")
    expect(notObject.problem).toBe("teamModels.slot4")
    // `null` is the JSON spelling of unset, so it is `unconfigured`, never `invalid`.
    const nullLeaf = resolveTeamModelSlot("Vision Analyst", { teamModels: { slot4: { provider: "p", model: "m", reasoningEffort: null } } })
    expect(nullLeaf).toMatchObject({ ok: true, route: { provider: "p", model: "m" } })
  })

  test("fallbacks are preserved in order; a malformed entry is dropped, never fatal (contract §8)", () => {
    /** A slot carrying a two-entry chain whose second entry is malformed. */
    const resolution = resolveTeamModelSlot("Architect", {
      teamModels: { slot1: { provider: "p", model: "m", fallbacks: [{ provider: "bp1", model: "bm1", reasoningEffort: "low" }, { provider: "bp2" }, { provider: "bp3", model: "bm3", reasoningEffort: 9 }] } },
    })
    expect(resolution.ok).toBe(true)
    if (!resolution.ok) throw new Error("unreachable: the slot is configured")
    // Order is the user's own; only the well-formed entry survives; the drops are COUNTED.
    expect(resolution.fallbacks).toEqual([{ provider: "bp1", model: "bm1", reasoningEffort: "low" }])
    expect(resolution.fallbacksDropped).toBe(2)
    // A fallbacks leaf that is not an array is dropped as a whole, and the run still resolves.
    const container = resolveTeamModelSlot("Architect", { teamModels: { slot1: { provider: "p", model: "m", fallbacks: "nope" } } })
    expect(container).toMatchObject({ ok: true, fallbacks: [], fallbacksDropped: 1 })
  })

  test("the deletion lock: a FULL agentRoutes block resolves identically to none", () => {
    /** A leftover per-member route table, exactly as an OLD workspace file still carries it. */
    const leftover = {
      agentRoutes: {
        Architect: { provider: "route-provider", model: "route-model", reasoningEffort: "low" },
        "Deep Worker": { model: "route-model" },
        "Vision Analyst": { provider: "route-provider" },
      },
    }
    // The block is IGNORED: the resolution is byte-for-byte the one a workspace with no table gets.
    expect(resolveTeamModelSlot("Deep Worker", leftover)).toEqual(resolveTeamModelSlot("Deep Worker", {}))
    expect(resolveTeamModelSlot("Architect", leftover)).toEqual(resolveTeamModelSlot("Architect", {}))
    expect(resolveTeamModelSlot("Vision Analyst", leftover)).toEqual(resolveTeamModelSlot("Vision Analyst", {}))
    // And it cannot move a CONFIGURED slot either: the slot alone decides.
    expect(teamModelRouteOfMember("Deep Worker", { ...leftover, teamModels: { slot3: { provider: "p", model: "m" } } })).toEqual({ provider: "p", model: "m" })
  })

  test("a member no slot routes is `unrouted` and answers no route (extension roles keep working)", () => {
    expect(resolveTeamModelSlot("not-a-roster-member", { teamModels: { slot1: { provider: "p", model: "m" } } })).toEqual({ ok: false, status: "unrouted", slot: undefined })
    expect(teamModelRouteOfMember("not-a-roster-member", { teamModels: { slot1: { provider: "p", model: "m" } } })).toBeUndefined()
  })

  test("the mpd_config_get disclosure names the slot leaves, and no longer the deleted table", () => {
    /** Every tool the row registered, captured by a minimal ctx the reader can walk. */
    const registered: any[] = []
    apply({ tools: { register: (t: any) => registered.push(t) }, provide: () => { /* no service needed here */ } } as any, {})
    /** The config-read tool, whose description is the knob surface's own documentation. */
    const tool = registered.find((t) => t.name === "mpd_config_get")
    expect(String(tool.description)).toContain("teamModels.slot1|slot2|slot3|slot4")
    expect(String(tool.description)).toContain("fallbacks")
    expect(String(tool.description)).not.toContain("agentRoutes")
  })
})
