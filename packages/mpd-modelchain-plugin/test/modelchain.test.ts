import { test, expect } from "bun:test"
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
