// Seam 4 — the runtime theme registration: the shipped palette is handed to the host's theme
// registry through the seam adapter, owned by this activation, and honestly reported.
//
// WHAT THESE ARMS PIN, and why each exists:
//   * the TS descriptor and `themes/mpd-tui.json` are ONE palette — a user may install either path,
//     and a drift between them would ship two different "mpd-tui" themes;
//   * every colour key is a host `Theme` key and the base is a host palette, so the host does not
//     silently skip half the declaration;
//   * the registration uses the descriptor BY IDENTITY, is owned by `ctx.effect`, and reports
//     `requested` (the host's plugin face has no read-back, so `confirmed` would be an overclaim);
//   * the three degrade paths (no seam, no register, a throwing register) each answer without a throw.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { MPD_THEME, registerTheme } from "../src/theme.ts"
import type { Log } from "../src/log.ts"
import type { PluginContextLike, SeamOutcome, TuiAdapter } from "../src/types.ts"

/** The palette file this package ships, resolved from the test's own URL (never a cwd guess). */
const SHIPPED = JSON.parse(readFileSync(fileURLToPath(new URL("../themes/mpd-tui.json", import.meta.url)), "utf8")) as Record<string, unknown>

/** The host's built-in palette names a runtime theme may overlay (`TuiThemeBase`). */
const HOST_BASES = ["light", "dark", "dark-ansi", "claude-dark", "claude-paper", "codex-lavender", "codex-paper"]

/** The host `Theme` keys this palette uses, read from the host's own `theme.d.ts` (0.18.0). */
const HOST_COLOR_KEYS = [
  "accent", "accentShimmer", "permission", "promptBorder", "text", "inactive", "subtle",
  "selectionBg", "success", "error", "warning",
]

/** A logger double: the seam only writes `debug`, and never a terminal. */
function quietLog(): Log {
  return { info: (): void => {}, warn: (): void => {}, debug: (): void => {} }
}

/** One effect the seam asked the activation to own. */
interface OwnedEffect {
  /** The label the host's effect ledger would record. */
  readonly label: string | undefined
  /** The cleanup the fiber would run on unload. */
  readonly cleanup: () => void
}

/** A minimal ctx double: `effect` is the only member this seam touches. */
function effectCtx(): { ctx: PluginContextLike; effects: OwnedEffect[] } {
  /** Everything the seam registered for cleanup. */
  const effects: OwnedEffect[] = []
  /** The ctx slice {@link registerTheme} drives. */
  const ctx = {
    effect: (cleanup: () => () => void, label?: string): void => {
      effects.push({ label, cleanup: cleanup() })
    },
  }
  return { ctx: ctx as unknown as PluginContextLike, effects }
}

/** A theme registry double that records the descriptor it was handed. */
function registryDouble(): { register: (descriptor: unknown, identity?: unknown) => () => void; calls: unknown[] } {
  /** The descriptors, by identity, in call order. */
  const calls: unknown[] = []
  return {
    register: (descriptor: unknown): (() => void) => {
      calls.push(descriptor)
      return (): void => {}
    },
    calls,
  }
}

/**
 * An adapter double whose `whenBound` either fires at once (a bound host) or never (an absent one).
 * @param service - the value handed to the `themes` callback.
 * @param bound - whether the seam binds.
 * @returns the adapter slice {@link registerTheme} drives.
 */
function adapterWith(service: unknown, bound: boolean): TuiAdapter {
  return {
    whenBound: (_key: string, setup: (value: unknown) => void): unknown => {
      if (bound) setup(service)
      return {}
    },
  } as unknown as TuiAdapter
}

/** The registration's outcome against one adapter double. */
function outcomeOf(service: unknown, bound: boolean): SeamOutcome {
  /** The ctx the registration owns its cleanup on. */
  const { ctx } = effectCtx()
  return registerTheme(ctx, adapterWith(service, bound), quietLog()).outcome()
}

describe("the shipped palette is one theme in two files", () => {
  test("the TS descriptor equals themes/mpd-tui.json", () => {
    /** The descriptor projected into the same open shape as the shipped file, so the two compare structurally. */
    const descriptor: unknown = { name: MPD_THEME.name, displayName: MPD_THEME.displayName, base: MPD_THEME.base, colors: MPD_THEME.colors }
    expect(descriptor).toEqual(SHIPPED)
  })

  test("every colour key and the base are host vocabulary", () => {
    expect(Object.keys(MPD_THEME.colors ?? {}).sort()).toEqual([...HOST_COLOR_KEYS].sort())
    expect(HOST_BASES).toContain(MPD_THEME.base)
    expect(MPD_THEME.name).toBe("mpd-tui")
  })
})

describe("registerTheme hands the declaration over and owns the cleanup", () => {
  test("the bound registry receives the descriptor by identity, and the effect is owned", () => {
    /** The host's registry double. */
    const registry = registryDouble()
    /** The ctx and what it was asked to own. */
    const { ctx, effects } = effectCtx()
    /** The seam handle under test. */
    const seam = registerTheme(ctx, adapterWith(registry, true), quietLog())
    expect(registry.calls).toHaveLength(1)
    expect(registry.calls[0]).toBe(MPD_THEME)
    expect(effects).toHaveLength(1)
    expect(effects[0]?.label).toBe("mpd-tui theme mpd-tui")
    expect(typeof effects[0]?.cleanup).toBe("function")
    expect(seam.outcome()).toMatchObject({ id: "themes", state: "requested" })
    expect(String(seam.outcome().detail)).toContain("no read-back")
  })

  test("an unbound seam, a registry without register() and a throwing register each degrade", () => {
    expect(outcomeOf(registryDouble(), false)).toMatchObject({ state: "absent" })
    expect(outcomeOf({}, true)).toMatchObject({ state: "refused" })
    expect(outcomeOf({ register: (): never => { throw new Error("duplicate theme") } }, true)).toMatchObject({ state: "refused" })
  })
})
