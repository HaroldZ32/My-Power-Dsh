import { describe, test, expect } from "bun:test"
import { DEFAULT_CHAINS, resolveRole, apply } from "../src/index.ts"

test("DEFAULT_CHAINS uses kebab-case keys and only deepseek-official providers", () => {
  expect(DEFAULT_CHAINS["sisyphus-junior"]).toBeDefined()
  expect(DEFAULT_CHAINS["multimodal-looker"]).toBeDefined()
  expect(DEFAULT_CHAINS["sisyphusJunior"]).toBeUndefined()
  expect(DEFAULT_CHAINS["multimodalLooker"]).toBeUndefined()
  for (const chain of Object.values(DEFAULT_CHAINS)) {
    for (const c of chain) expect(c.provider).toBe("deepseek-official")
  }
})

test("resolveRole resolves kebab-case and legacy camelCase keys to the same chain", () => {
  /** The chain resolved for the kebab-case spelling, which every other spelling must match. */
  const kebab = resolveRole("sisyphus-junior", {})
  expect(kebab.provider).toBe("deepseek-official")
  expect(kebab.model).toBe("deepseek-v4-flash")
  expect(kebab.chain.length).toBeGreaterThan(0)
  expect(resolveRole("sisyphusJunior", {})).toEqual(kebab)
  expect(resolveRole("multimodal-looker", {}).model).toBe("deepseek-v4-flash-vision-exp")
  expect(resolveRole("multimodalLooker", {}).model).toBe("deepseek-v4-flash-vision-exp")
  expect(resolveRole("unknown-role", {}).provider).toBe("deepseek-official")
})

/**
 * The roster-service double the route tool resolves against. It publishes the shape
 * `mpd-roles-plugin` does — `list()` names every role, `get(key)` resolves one by a NAME spelling
 * (or, on the internal path this double imitates, by its stable id) — so the tool's own input gate
 * is what refuses an id, not the double's.
 *
 * `chain` is per-test on purpose: an EMPTY one is the documented fallback condition under which
 * the shipped/configured table (keyed by the internal id) answers instead.
 *
 * @param roles - the roles this double serves: internal id, display name, optional own chain.
 * @returns the service double: `list()` for the names, `get()` for one resolved role or null.
 */
function rosterDouble(roles: Array<{ id: string; name: string; chain?: Array<{ provider: string; model: string }> }>): { list: () => Array<{ name: string }>; get: (k: string) => unknown } {
  /** The same collapse the roster applies: case-, space-, hyphen- and underscore-insensitive. */
  const collapse = (s: string): string => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")
  return {
    list: () => roles.map((r) => ({ name: r.name })),
    get: (k: string) => {
      /** The role as the service resolves it: by a name spelling, else by the internal id. */
      const found = roles.find((r) => collapse(r.name) === collapse(k) || r.id === k)
      return found ? { id: found.id, name: found.name, chain: found.chain ?? [] } : null
    }
  }
}

test("mpd_modelchain_resolve takes a roster NAME; an internal id or an unknown role is refused", async () => {
  /** Every tool definition the plugin registered, in registration order. */
  const tools: any[] = []
  /** The roster the tool resolves against: one worker role, carrying its own chain. */
  const roster = rosterDouble([{ id: "sisyphus-junior", name: "Junior Engineer", chain: [{ provider: "deepseek-official", model: "deepseek-v4-flash" }] }])
  /** The minimal row context: a `register` sink plus a `get` that answers `mpdRoles` only. */
  const ctx: any = {
    tools: {
      /** Keep the definition the plugin registers, so the test can call its `execute`. */
      register(d: any): void { tools.push(d) }
    },
    /** Answer the roster lookup with the double and every other service with undefined. */
    get: (n: string) => (n === "mpdRoles" ? roster : undefined)
  }
  apply(ctx, {})
  /** The route-resolver tool the plugin registered. */
  const tool = tools.find((t) => t.name === "mpd_modelchain_resolve")
  /** The route the tool answered for the role's NAME, in a non-canonical spelling. */
  const res = await tool.execute({ role: "junior engineer" })
  expect(res.provider).toBe("deepseek-official")
  expect(res.model).toBe("deepseek-v4-flash")
  expect("skipped" in res).toBe(false)
  expect(res.chain.length).toBeGreaterThan(0)
  /** The refusal of the SAME role addressed by its internal id — the text names roster names only
   *  and never repeats the rejected key, so it cannot advertise the alias it refuses. */
  const refusal = await tool.execute({ role: "sisyphus-junior" }).then(() => "", (e: unknown) => (e instanceof Error ? e.message : String(e)))
  expect(refusal).toContain("unknown role")
  expect(refusal).toContain("Junior Engineer")
  expect(refusal).not.toContain("sisyphus")
  /** An unknown role and a missing one are refused too: no silent generic fallback survives. */
  await expect(tool.execute({ role: "bogus" })).rejects.toThrow(/unknown role/)
  await expect(tool.execute({})).rejects.toThrow(/unknown role/)
})

test("modelchain.sisyphus-junior config key is resolved through the mpdConfig service", async () => {
  /** Every tool definition the plugin registered, in registration order. */
  const tools: any[] = []
  /** The dotted-key config document the fake service resolves against. */
  const cfg = { modelchain: { "sisyphus-junior": [{ provider: "deepseek-official", model: "deepseek-v4-pro" }] } }
  /** The config service double: `get` walks a dotted key, and answers the whole document when asked for none. */
  const mpdConfig = {
    get: (k?: string) => (k === undefined ? cfg : k.split(".").reduce((a: any, p: string) => (a == null ? undefined : a[p]), cfg)),
  }
  /** The roster the tool resolves the NAME against. Its one role carries NO chain of its own, which
   *  is the documented fallback condition: the shipped/configured table — keyed by the INTERNAL id,
   *  which is what `resolveRole` and the `modelchain.<id>` config keys speak — is what answers. */
  const roster = rosterDouble([{ id: "sisyphus-junior", name: "Junior Engineer" }])
  /** The row context: a `register` sink plus a `get` that answers `mpdConfig` and `mpdRoles`. */
  const ctx: any = {
    tools: {
      /** Keep the definition the plugin registers, so the test can call its `execute`. */
      register(d: any): void { tools.push(d) }
    },
    /** Answer the two service lookups with their doubles and every other one with undefined. */
    get: (n: string) => (n === "mpdConfig" ? mpdConfig : n === "mpdRoles" ? roster : undefined)
  }
  apply(ctx, {})
  /** The route-resolver tool the plugin registered. */
  const tool = tools.find((t) => t.name === "mpd_modelchain_resolve")
  /** The route the config overlay produced for the role, addressed by its NAME. */
  const res = await tool.execute({ role: "Junior Engineer" })
  expect(res.provider).toBe("deepseek-official")
  expect(res.model).toBe("deepseek-v4-pro")
})

// AC2 of the model-config-live-refresh wave (fix/model-config-live-refresh): the `modelchain.<key>`
// overlay is re-read PER CALL, so a change made in-process — no restart, no re-apply — is what the
// NEXT resolution answers. Pre-wave this file froze the overlay into a closure at apply().
describe("AC2 — the overlay is re-read per call (R1)", () => {
  test("a changed overlay changes the NEXT resolution in-process", async () => {
    /** Every tool definition the plugin registered, in registration order. */
    const tools: any[] = []
    /** The MUTABLE config document: the case flips its chain BETWEEN two calls of one mount. */
    const cfg: any = { modelchain: { sisyphus: [{ provider: "deepseek-official", model: "deepseek-v4-pro" }] } }
    /** The config service double over the mutable document. */
    const mpdConfig = {
      get: (k?: string) => (k === undefined ? cfg : k.split(".").reduce((a: any, p: string) => (a == null ? undefined : a[p]), cfg)),
    }
    /** The roster double: the role carries a chain of its own, so the case also proves the overlay
     *  OUTRANKS the roster's static chain — otherwise a role with a chain could never be re-routed. */
    const roster = rosterDouble([{ id: "sisyphus", name: "Senior Engineer", chain: [{ provider: "deepseek-official", model: "deepseek-v4-flash" }] }])
    /** The row context: a `register` sink plus a `get` that answers `mpdConfig` and `mpdRoles`. */
    const ctx: any = {
      tools: {
        /** Keep the definition the plugin registers, so the test can call its `execute`. */
        register(d: any): void { tools.push(d) }
      },
      /** Answer the two service lookups with their doubles and every other one with undefined. */
      get: (n: string) => (n === "mpdConfig" ? mpdConfig : n === "mpdRoles" ? roster : undefined)
    }
    apply(ctx, {})
    /** The route-resolver tool the plugin registered. */
    const tool = tools.find((t) => t.name === "mpd_modelchain_resolve")
    /** The FIRST resolution: the overlay (v4-pro) beats the roster's own chain (v4-flash). */
    const first = await tool.execute({ role: "Senior Engineer" })
    expect(first.model).toBe("deepseek-v4-pro")
    // The in-process change — a save through the config layer, or an mpd.jsonc edit the watcher
    // picked up. No re-apply, no restart: the next call must answer with the NEW overlay.
    cfg.modelchain.sisyphus = [{ provider: "deepseek-official", model: "deepseek-flash" }]
    /** The SECOND resolution against the same mount: the changed overlay is what answers. */
    const second = await tool.execute({ role: "Senior Engineer" })
    expect(second.model).toBe("deepseek-flash")
    // Removing the overlay entirely falls back to the roster's own chain, per-call as well.
    delete cfg.modelchain.sisyphus
    /** The THIRD resolution: no overlay, so the roster chain answers again. */
    const third = await tool.execute({ role: "Senior Engineer" })
    expect(third.model).toBe("deepseek-v4-flash")
  })

  test("a config service that appears AFTER apply is still honoured (the sibling-visibility fix)", async () => {
    /** Every tool definition the plugin registered, in registration order. */
    const tools: any[] = []
    /** The config service, NOT mounted at apply time — rows apply concurrently, so a sibling
     *  provider that starts later was invisible to the frozen-closure code FOREVER. */
    let mpdConfig: any = undefined
    /** The roster double whose role carries no chain, so the fallback table answers. */
    const roster = rosterDouble([{ id: "oracle", name: "Architect" }])
    /** The row context whose `mpdConfig` lookup answers whatever the variable holds. */
    const ctx: any = {
      tools: {
        /** Keep the definition the plugin registers, so the test can call its `execute`. */
        register(d: any): void { tools.push(d) }
      },
      /** Answer the roster always, and the config service only once it has "applied". */
      get: (n: string) => (n === "mpdConfig" ? mpdConfig : n === "mpdRoles" ? roster : undefined)
    }
    apply(ctx, {})
    /** The route-resolver tool the plugin registered. */
    const tool = tools.find((t) => t.name === "mpd_modelchain_resolve")
    // Before the config row applies, the shipped default answers (oracle's default chain head).
    expect((await tool.execute({ role: "Architect" })).model).toBe("deepseek-v4-pro")
    // The sibling applies LATE: from this call on, its overlay is what answers.
    const cfg: any = { modelchain: { oracle: [{ provider: "deepseek-official", model: "deepseek-flash" }] } }
    mpdConfig = { get: (k?: string) => (k === undefined ? cfg : k.split(".").reduce((a: any, p: string) => (a == null ? undefined : a[p]), cfg)) }
    expect((await tool.execute({ role: "Architect" })).model).toBe("deepseek-flash")
  })
})
