// The settings bridge must see a service that lives BELOW the root ctx.
//
// MEASURED (docker/ui, 2026-09-27): the TUI's MPD settings section rendered `[命名空间未注册]` with
// all 25 knobs reading `（未设置）`, and both surfaces logged `[mpd-config] settings bridge: could not
// register the "mpd" namespace (settings service is unavailable)`. A `settings` service existed —
// the deferred inject had fired — but the adapter read the ROOT ctx, and Cordis resolves a service
// through the fiber that provides it, so a service below the root is invisible there. This file
// pins the two halves agreeing: the inject's scoped ctx is what `settingsRegister` must use.
import { describe, expect, test } from "bun:test"
import { createDshAdapter } from "../src/index"

/** A ctx whose `settings` exists ONLY for a scoped inject callback, never on the root. */
function ctxWithScopedSettings(settings: any): {
  /** The root ctx: a `get` blind to the scoped service, plus the inject that can reach it. */
  root: { get(name: string): undefined; inject(deps: string[], callback: (scoped: any) => void): () => void }
  /** The registration sink handed back; this double never fills it. */
  registered: string[]
} {
  /** Registration sink the helper hands back; this double never fills it. */
  const registered: string[] = []
  /** The root ctx, whose `get` deliberately cannot see a service provided in another fiber. */
  const root = {
    get: (name: string) => {
      // The live shape: the root CANNOT see a service provided in another fiber.
      if (name === "settings") return undefined
      if (name === "mpdDsh") return undefined
      return undefined
    },
    inject: (deps: string[], callback: (scoped: any) => void) => {
      if (deps.includes("settings")) callback({ get: (name: string) => (name === "settings" ? settings : undefined), settings })
      return () => {}
    },
  }
  return { root, registered }
}

describe("the settings bridge resolves the SCOPED service", () => {
  test("a settings service that exists only below the root is still reachable", () => {
    /** Namespaces the scoped service collected, asserted after the deferred inject fires. */
    const registered: Array<{ namespace: string }> = []
    /** The root ctx, paired with a settings service reachable only through the inject. */
    const { root } = ctxWithScopedSettings({ register: (namespace: string) => registered.push({ namespace }) })
    /** The adapter under test, built over that root. */
    const adapter = createDshAdapter(root)
    /** Set by the deferred callback, proving the inject fired synchronously here. */
    let fired = false
    adapter.whenSettingsAvailable(() => { fired = true })
    expect(fired).toBe(true)
    /** The registration outcome, which must report success. */
    const result = adapter.settingsRegister("mpd", {})
    expect(result).toEqual({ ok: true })
    expect(registered.map((entry) => entry.namespace)).toEqual(["mpd"])
  })

  test("NO scoped service, no root service -> the honest failure sentence is unchanged", () => {
    /** A ctx with neither a scoped nor a root settings service. */
    const root = { get: () => undefined, inject: () => () => {} }
    /** The adapter under test, built over that bare ctx. */
    const adapter = createDshAdapter(root)
    adapter.whenSettingsAvailable(() => {})
    /** The registration outcome, which must be the honest failure value. */
    const result = adapter.settingsRegister("mpd", {})
    expect(result.ok).toBe(false)
    expect(String((result as any).error)).toContain("settings service is unavailable")
  })

  test("a PRESENT service without register() says so instead of claiming it is unavailable", () => {
    // The measured dsh-tui shape: the inject fires immediately, so a `settings` service exists —
    // and it cannot register. One sentence for both shapes is what made this take an investigation.
    const registered: string[] = []
    /** The root ctx, paired with a settings service that cannot register. */
    const { root } = ctxWithScopedSettings({ describe: () => [], get: () => undefined })
    /** The adapter under test, built over that root. */
    const adapter = createDshAdapter(root)
    adapter.whenSettingsAvailable(() => {})
    /** The failure value, whose message must name the missing register(). */
    const result = adapter.settingsRegister("mpd", {})
    expect(result.ok).toBe(false)
    expect(String((result as any).error)).toContain("no register()")
    expect(registered).toEqual([])
  })

  test("a ROOT service still works when no inject ever fires (the non-deferred path)", () => {
    /** Namespaces the root service collected, asserted after the direct call. */
    const registered: string[] = []
    /** A root ctx that serves settings directly, with no inject involved. */
    const root = { get: (name: string) => (name === "settings" ? { register: (ns: string) => registered.push(ns) } : undefined) }
    /** The adapter under test, built over the root-serving ctx. */
    const adapter = createDshAdapter(root)
    /** The registration outcome, which must report success. */
    const result = adapter.settingsRegister("mpd", {})
    expect(result).toEqual({ ok: true })
    expect(registered).toEqual(["mpd"])
  })
})
