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

test("mpd_modelchain_resolve resolves kebab keys and drops the dead skipped field", async () => {
  /** Every tool definition the plugin registered, in registration order. */
  const tools: any[] = []
  /** The minimal row context: a `register` sink plus a `get` that answers no service at all. */
  const ctx: any = {
    tools: {
      /** Keep the definition the plugin registers, so the test can call its `execute`. */
      register(d: any): void { tools.push(d) }
    },
    get: () => undefined
  }
  apply(ctx, {})
  /** The route-resolver tool the plugin registered. */
  const tool = tools.find((t) => t.name === "mpd_modelchain_resolve")
  /** The route the tool answered for the kebab-case role key. */
  const res = await tool.execute({ role: "sisyphus-junior" })
  expect(res.provider).toBe("deepseek-official")
  expect(res.model).toBe("deepseek-v4-flash")
  expect("skipped" in res).toBe(false)
  expect(res.chain.length).toBeGreaterThan(0)
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
  /** The row context: a `register` sink plus a `get` that answers only `mpdConfig`. */
  const ctx: any = {
    tools: {
      /** Keep the definition the plugin registers, so the test can call its `execute`. */
      register(d: any): void { tools.push(d) }
    },
    /** Answer the `mpdConfig` lookup with the double and every other service with undefined. */
    get: (n: string) => (n === "mpdConfig" ? mpdConfig : undefined)
  }
  apply(ctx, {})
  /** The route-resolver tool the plugin registered. */
  const tool = tools.find((t) => t.name === "mpd_modelchain_resolve")
  /** The route the config overlay produced for the role. */
  const res = await tool.execute({ role: "sisyphus-junior" })
  expect(res.provider).toBe("deepseek-official")
  expect(res.model).toBe("deepseek-v4-pro")
})
