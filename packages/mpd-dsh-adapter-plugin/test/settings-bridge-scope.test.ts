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
function ctxWithScopedSettings(settings: any) {
  const registered: string[] = []
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
    const registered: Array<{ namespace: string }> = []
    const { root } = ctxWithScopedSettings({ register: (namespace: string) => registered.push({ namespace }) })
    const adapter = createDshAdapter(root)
    let fired = false
    adapter.whenSettingsAvailable(() => { fired = true })
    expect(fired).toBe(true)
    const result = adapter.settingsRegister("mpd", {})
    expect(result).toEqual({ ok: true })
    expect(registered.map((entry) => entry.namespace)).toEqual(["mpd"])
  })

  test("NO scoped service, no root service -> the honest failure sentence is unchanged", () => {
    const root = { get: () => undefined, inject: () => () => {} }
    const adapter = createDshAdapter(root)
    adapter.whenSettingsAvailable(() => {})
    const result = adapter.settingsRegister("mpd", {})
    expect(result.ok).toBe(false)
    expect(String((result as any).error)).toContain("settings service is unavailable")
  })

  test("a PRESENT service without register() says so instead of claiming it is unavailable", () => {
    // The measured dsh-tui shape: the inject fires immediately, so a `settings` service exists —
    // and it cannot register. One sentence for both shapes is what made this take an investigation.
    const registered: string[] = []
    const { root } = ctxWithScopedSettings({ describe: () => [], get: () => undefined })
    const adapter = createDshAdapter(root)
    adapter.whenSettingsAvailable(() => {})
    const result = adapter.settingsRegister("mpd", {})
    expect(result.ok).toBe(false)
    expect(String((result as any).error)).toContain("no register()")
    expect(registered).toEqual([])
  })

  test("a ROOT service still works when no inject ever fires (the non-deferred path)", () => {
    const registered: string[] = []
    const root = { get: (name: string) => (name === "settings" ? { register: (ns: string) => registered.push(ns) } : undefined) }
    const adapter = createDshAdapter(root)
    const result = adapter.settingsRegister("mpd", {})
    expect(result).toEqual({ ok: true })
    expect(registered).toEqual(["mpd"])
  })
})
