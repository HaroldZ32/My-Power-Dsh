// INDEPENDENT VERIFICATION of R13 — why the sidebar panel was invisible (wave `tui-dag-port`).
//
// WHO WROTE THIS. The reviewer (`fidelity-verifier`), not the lane that root-caused it. Every arm
// reads the INSTALLED HOST — the real `@deepseek-harness-tui/dsh-tui` package on this machine — and
// calls the host's OWN functions rather than restating them, so a host upgrade that changes the rule
// re-judges this file instead of sliding past it. The real-PTY frames that corroborate these arms
// live under `evidence/tui/dag-port/verification/pty/`; this file pins the MECHANISM those frames
// show, so a regression reddens in `bun test` instead of waiting for the next capture.
//
// THE CHAIN THIS FILE PINS (each link measured, see the report):
//   1. the host enables sidebar panels from ONE comma-separated CSV whose default is exactly the
//      three builtins — no plugin panel is in it until something adds it;
//   2. the panels adapter DOES append a successfully registered plugin id to that CSV;
//   3. the CSV is an in-memory live setting, and the host's settings-apply path REWRITES it from
//      configuration — so the append is transient;
//   4. a sidebar splits only at or above `CHAT_MIN + PANEL_MIN + DIVIDER`, and at that exact width
//      the panel column is `PANEL_MIN` cells wide — so a plugin that declares a WIDER floor than the
//      host's own minimum gets the host's "too narrow" notice in the band between the two.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { PANEL_KEEPER_LADDER_MS, createPanelEnableKeeper, probeHostPrefs } from "../../mpd-tui-adapter-plugin/src/index.js"
import { PANEL_MIN_COLUMNS, PANEL_SLUG, PANEL_TITLE } from "../src/panel"

/**
 * The installed DSH-TUI package root, resolved from the launcher on `PATH`.
 *
 * Resolved rather than hard-coded because the whole file is a statement about the INSTALLED host: a
 * hard-coded path would keep passing against a package that is no longer the one being launched. An
 * absent launcher throws — a skip here would be a vacuous pass on the one clause this file exists for.
 * @returns the host package's absolute root directory.
 */
function hostRoot(): string {
  /** The launcher's path on `PATH`, or null when the host is not installed at all. */
  const launcher = Bun.which("dsh-tui")
  if (launcher === null) throw new Error("dsh-tui is not on PATH: R13 cannot be verified against an absent host")
  /** The launcher's real path, with the symlink pnpm/npm installs behind it resolved. */
  const real = Bun.spawnSync(["readlink", "-f", launcher]).stdout.toString().trim()
  // `<root>/bin/dsh-tui.js` -> `<root>`: two directories up, the same shape every lane resolves.
  return dirname(dirname(real))
}

/** The installed host package root, read once for every arm below. */
const HOST = hostRoot()

/** The host's display-preferences module, whose live settings own the panel CSV. */
const PREFS_PATH = join(HOST, "lib", "types", "tuiDisplayPrefs.js")

/** The host's side-panel geometry module: the split thresholds, as pure functions. */
const DIMENSIONS_PATH = join(HOST, "lib", "types", "components", "sidePanel", "dimensions.js")

/** The host's panels adapter, which owns the register -> enable wiring. */
const PANELS_PATH = join(HOST, "lib", "types", "dsh-adapter", "panels.js")

/** The host's settings adapter, which re-applies the configured CSV. */
const PLUGIN_PATH = join(HOST, "lib", "types", "dsh-adapter", "plugin.js")

/** The host's live-setting factories and panel-CSV rules. */
const prefs = await import(PREFS_PATH) as {
  DEFAULT_SIDE_PANEL_IDS: string
  SIDE_PANEL_ID_PATTERN: RegExp
  normalizeSidePanelPanels(value: unknown): string
  parseSidePanelIds(value: unknown): string[]
}

/** The host's split geometry, as pure functions of the content width. */
const dimensions = await import(DIMENSIONS_PATH) as {
  CHAT_MIN_COLUMNS: number
  PANEL_MIN_COLUMNS: number
  DIVIDER_COLUMNS: number
  canSplit(columns: number): boolean
  resolveSidePanelGeometry(input: { columns: number; open: boolean; zoom: boolean; ratio: number }): { chat: number; panel: number } | null
}

describe("R13 · the host's panel enablement rule (read from the installed host)", () => {
  test("the default enabled CSV names the three builtins and NOTHING of ours", () => {
    expect(prefs.DEFAULT_SIDE_PANEL_IDS).toBe("todo,jobs,agents")
    // The load-bearing half: an unconfigured host cannot show a plugin panel, because the default
    // list simply does not contain one. Every visibility claim must therefore explain the ADD.
    expect(prefs.parseSidePanelIds(prefs.DEFAULT_SIDE_PANEL_IDS)).not.toContain("todo:team")
    for (const id of prefs.parseSidePanelIds(prefs.DEFAULT_SIDE_PANEL_IDS)) {
      expect(prefs.SIDE_PANEL_ID_PATTERN.test(id)).toBe(true)
    }
  })

  test("the id GRAMMAR is not the blocker: a composed plugin id round-trips", () => {
    // The id the host composes is `<pluginId>:<slug>`, so the grammar must accept a colon namespace;
    // a panel is refused for many reasons, and this arm removes one of them from suspicion.
    expect(prefs.SIDE_PANEL_ID_PATTERN.test("act1:team")).toBe(true)
    expect(prefs.SIDE_PANEL_ID_PATTERN.test("mpd-tui:team")).toBe(true)
    expect(prefs.parseSidePanelIds(prefs.normalizeSidePanelPanels("todo,jobs,agents,act1:team")))
      .toEqual(["todo", "jobs", "agents", "act1:team"])
  })

  test("the adapter DOES append a registered id to the CSV — so the mechanism exists and can be undone", () => {
    /** The panels adapter's source, where the register -> enable wiring lives. */
    const source = readFileSync(PANELS_PATH, "utf8")
    expect(source).toContain("enablePanelIdInStore")
    // The append itself, as the adapter writes it: read the CSV, push the id, apply it back.
    expect(source).toMatch(/function enablePanelIdInStore[\s\S]{0,400}applySidePanelPanels/)
    // And the live setting is IN-MEMORY: no persistence, so the CSV is rebuilt from configuration on
    // every apply. This is what makes the append transient rather than durable.
    /** The display-preferences module, whose live settings the panels adapter writes through. */
    const prefsSource = readFileSync(PREFS_PATH, "utf8")
    /** The live-setting factory's own body, sliced so the persistence check cannot see a neighbour. */
    const factory = prefsSource.slice(prefsSource.indexOf("function createLiveSetting"), prefsSource.indexOf("const pageMarginStore"))
    expect(factory).toContain("let state = initial")
    expect(factory).not.toContain("writeFileSync")
    expect(factory).not.toContain("readFileSync")
  })

  test("the host REWRITES the CSV from configuration, which is how a registered panel disappears", () => {
    /** The settings adapter's source: the apply path that mirrors configuration into the live stores. */
    const source = readFileSync(PLUGIN_PATH, "utf8")
    expect(source).toContain("applySidePanelPanels(config.sidePanel?.panels)")
    // The configured value's own default is the three builtins (the schema default), so an unedited
    // config re-applies `todo,jobs,agents` and drops any id a plugin appended.
    expect(source).toContain("DEFAULT_SIDE_PANEL_IDS")
    expect(prefs.normalizeSidePanelPanels(prefs.DEFAULT_SIDE_PANEL_IDS)).toBe("todo,jobs,agents")
  })
})

describe("R13 · the width band in which the panel cannot be seen at all", () => {
  test("a sidebar splits only at CHAT_MIN + PANEL_MIN + DIVIDER, and no lower", () => {
    /** The exact width the host's own minimums require before any split exists. */
    const threshold = dimensions.CHAT_MIN_COLUMNS + dimensions.PANEL_MIN_COLUMNS + dimensions.DIVIDER_COLUMNS
    expect(dimensions.canSplit(threshold - 1)).toBe(false)
    expect(dimensions.canSplit(threshold)).toBe(true)
    // Below the threshold `resolveSidePanelGeometry` says "no split" even with `open: true`, so NO
    // plugin-side call can open a sidebar there — the visible remedy is a wider terminal.
    expect(dimensions.resolveSidePanelGeometry({ columns: threshold - 1, open: true, zoom: false, ratio: 0.68 })).toBeNull()
  })

  test("AT the split threshold the panel column is exactly the host's own floor — so a wider floor is a trap", () => {
    /** The width the host's minimums first allow a split at. */
    const threshold = dimensions.CHAT_MIN_COLUMNS + dimensions.PANEL_MIN_COLUMNS + dimensions.DIVIDER_COLUMNS
    /** The geometry the host resolves at that width. */
    const geometry = dimensions.resolveSidePanelGeometry({ columns: threshold, open: true, zoom: false, ratio: 0.68 })
    expect(geometry?.panel).toBe(dimensions.PANEL_MIN_COLUMNS)
    // MEASURED (2026-10-06): while this bundle declared `minColumns: 32` the panel column stayed
    // BELOW 32 until the content width reached 101, and `PanelHost` paints its own
    // `panel-too-narrow` notice when a panel declares a floor above the width it is given — so the
    // panel was invisible across content widths 93..100 where the sidebar itself opened fine. The
    // declaration is now the host's own floor, and the arm below is what keeps it there.
    /** The first content width at which this bundle's declared floor is actually satisfied. */
    let firstWidth = -1
    for (let columns = threshold; columns <= 260; columns++) {
      /** The geometry the host resolves at this width, null when it refuses to split. */
      const resolved = dimensions.resolveSidePanelGeometry({ columns, open: true, zoom: false, ratio: 0.68 })
      if (resolved !== null && resolved.panel >= PANEL_MIN_COLUMNS) {
        firstWidth = columns
        break
      }
    }
    // NO TRAP BAND: the declared floor is satisfied at the VERY FIRST width at which the host will
    // split at all. A panel that declared more than the host's own minimum would push `firstWidth`
    // past `threshold` and redden here. This is the sharper form of the same property the arm below
    // spells directly, and it is the one that actually caught 32: the band it found was real, and it
    // existed exactly while this bundle asked the host for four more columns than the host guarantees.
    expect(firstWidth).toBe(threshold)
    // THE PROPERTY ITSELF, spelled the way a reader can check it at any host version: never ask the
    // host for more room than its own floor guarantees. `32 <= 28` is what would have been false.
    expect(PANEL_MIN_COLUMNS <= dimensions.PANEL_MIN_COLUMNS).toBe(true)
    // THIS IS THE INVARIANT THE BAND ARGUMENT RESTS ON, and it is the one thing worth changing first:
    // a panel may not ask for more room than the host's own geometry guarantees. `PANEL_MIN_COLUMNS`
    // is this bundle's descriptor value; the arm fails when it exceeds the host's floor.
    expect(`${firstWidth}:${PANEL_MIN_COLUMNS <= dimensions.PANEL_MIN_COLUMNS}`).toBe(`${firstWidth}:true`)
  })

  test("the descriptor this bundle registers is the shape the host accepts", () => {
    // Cheap and load-bearing: the host refuses a descriptor whose slug is not a single lowercase
    // segment or whose title clamps to nothing, and every refusal path is silent from the caller's
    // side. Pinning the SHAPE here keeps a later edit from making the panel unregistrable.
    expect(/^[a-z][a-z0-9_-]*$/u.test(PANEL_SLUG)).toBe(true)
    expect(PANEL_TITLE.length).toBeGreaterThan(0)
    expect(PANEL_MIN_COLUMNS).toBe(dimensions.PANEL_MIN_COLUMNS)
  })
})

// ── R13b: the id the host COMPOSES is not the plugin's name ─────────────────────────────────────
//
// This is the correction that makes the whole defect actionable. `pluginIdFor(caller, owner)` returns
// the caller's Component identity when it has one and its own `act<N>` fallback when it does not, and
// a loader ROW has no Component admission — so the sidebar receives `act1:team`, never
// `mpd-tui:team`. Every arm below reads the INSTALLED host rather than restating the rule, and the
// MEASURED corroboration is the probe log under
// `evidence/dag/dag-edges-scroll/panel-visibility/20261006T145907Z/arm-a-stock/`, whose registry
// snapshots carry `act1:team@plugin,act1:dag@plugin,act1:workmate@plugin`.

describe("R13b · the composed panel id (read from the installed host)", () => {
  test("the host composes `<pluginId>:<slug>`, and `<pluginId>` comes from the caller's identity", () => {
    /** The panels adapter's source, where the composition lives. */
    const source = readFileSync(PANELS_PATH, "utf8")
    // The final id is the host's own construction, not something a caller may spell.
    expect(source).toContain("const finalId = pluginId + ':' + d.id")
    // The prefix is the identity's componentId ONLY when a Component identity exists …
    expect(source).toMatch(/function pluginIdFor\(caller, owner\)[\s\S]{0,400}identity\.componentId/u)
    // … and otherwise the host mints its own `act<N>` — the branch a loader row takes.
    expect(source).toContain("fallback = 'act' + String(fallbackSeq)")
  })

  test("a Component identity exists only for an ADMITTED Component, which a patch row never is", () => {
    /** The host's Component-identity module, which owns the WeakMap `pluginIdFor` reads. */
    const identitySource = readFileSync(join(HOST, "lib", "types", "dsh-adapter", "component-identity.js"), "utf8")
    // The id the host would use is the projection's NAME, written only by the admission function …
    expect(identitySource).toContain("componentId: projection.metadata.name")
    expect(identitySource).toContain("export function bindComponentIdentity(")
    // … so a caller the admission never ran for has NO identity, and `pluginIdFor` falls through to
    // `act<N>`. THIS bundle's TUI row is mounted by `cordis.patch.yml` as a plain row, which is the
    // loader path, not the plugin-admission path — hence the measured `act1:*` ids.
    /** This bundle's patch layer, where the TUI row is mounted. */
    const bundlePatch = readFileSync(join(import.meta.dir, "..", "..", "..", "cordis.patch.yml"), "utf8")
    expect(bundlePatch).toMatch(/- id: mpd-tui\n\s+name: '@mpd-dsh\/mpd\/packages\/mpd-tui-plugin\/dist\/index\.js'/u)
    // And the grammar accepts the composed form in both spellings, so the GRAMMAR is not what
    // decides which one arrives — the identity is.
    expect(prefs.SIDE_PANEL_ID_PATTERN.test("act1:team")).toBe(true)
    expect(prefs.SIDE_PANEL_ID_PATTERN.test("mpd-tui:team")).toBe(true)
  })
})

// ── R13c: the bounded re-assert this bundle adds, and its negative control ──────────────────────
//
// The keeper lives in the TUI ADAPTER (`packages/mpd-tui-adapter-plugin/src/index.ts`) because it is
// the second, and last, host-internals contact (§6). Its clock and its store are injectable, so every
// arm below is deterministic: no real timer, no real brain, and a fake CSV the arm can inspect.

describe("R13c · the enable-list keeper (this bundle's bounded re-assert)", () => {
  test("it appends ONLY its own registered ids, preserving the user's list exactly", async () => {
    /** Every CSV the keeper wrote, in order. */
    const written: string[] = []
    /** A stand-in host store, seeded with a user list that names somebody else's panel. */
    const store = {
      getSidePanelPanels: (): unknown => "todo,jobs,agents,someone:else",
      applySidePanelPanels: (value: unknown): unknown => { written.push(String(value)); return value },
    }
    /** The controllable clock the arm drives by hand. */
    const clock = fakeClock()
    /** The keeper under test, with only the ladder's own LENGTH exercised here. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: store }), schedule: clock.schedule })
    keeper.observe("act1:team")
    keeper.observe("act1:dag")
    // A duplicate registration cannot arm a second ladder, and cannot add a second token either.
    keeper.observe("act1:team")
    expect(clock.delays).toEqual([...PANEL_KEEPER_LADDER_MS])
    await clock.runNext()
    expect(written).toEqual(["todo,jobs,agents,someone:else,act1:team,act1:dag"])
    expect(keeper.outcome().ids).toEqual(["act1:team", "act1:dag"])
    expect(keeper.outcome().reasserted).toBe(1)
  })

  test("it KEEPS sampling past the first clean read — the measured loss lands after it", async () => {
    // MEASURED: panels register at about +1056 ms and the host's own `dsh-tui` row re-applies its
    // config at +5403 ms, so a ladder that stopped at its first clean read would report success
    // while the panel was about to disappear. The arm drives exactly that sequence.
    /** The CSV the fake host store holds; the arm mutates it to imitate the host's re-apply. */
    let csv = "todo,jobs,agents"
    /** Every CSV the keeper wrote. */
    const written: string[] = []
    /** The stand-in store. */
    const store = {
      getSidePanelPanels: (): unknown => csv,
      applySidePanelPanels: (value: unknown): unknown => { csv = String(value); written.push(csv); return csv },
    }
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: store }), schedule: clock.schedule })
    keeper.observe("act1:team")
    await clock.runNext()
    expect(csv).toBe("todo,jobs,agents,act1:team")
    // The host re-applies its config, exactly as the measured `Fiber._reload` does.
    csv = "todo,jobs,agents"
    await clock.runNext()
    expect(csv).toBe("todo,jobs,agents,act1:team")
    expect(keeper.outcome().reasserted).toBe(2)
    // A third tick finds it present and writes nothing further.
    await clock.runNext()
    expect(keeper.outcome().reasserted).toBe(2)
  })

  test("it STANDS DOWN when the configuration already names ANY of ours", async () => {
    // THE CAPTAIN'S RULING, as an arm: the keeper repairs a list that names NONE of us, and never
    // overrules one that names ANY of us. The second case is a user who removed one page on purpose
    // and kept the rest — under an "append whatever is missing" rule the keeper would put the removed
    // page straight back, which is compensation the user did not ask for.
    /** The CSV the fake host store holds; the arm mutates it to imitate the host's own re-apply. */
    let csv = "act1:team,act1:dag"
    /** Every CSV the keeper wrote; both stand-down ticks must leave this EMPTY. */
    const written: string[] = []
    /** The stand-in store. */
    const store = {
      getSidePanelPanels: (): unknown => csv,
      applySidePanelPanels: (value: unknown): unknown => { csv = String(value); written.push(csv); return csv },
    }
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, holding all three ids this bundle registers. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: store }), schedule: clock.schedule })
    keeper.observe("act1:team")
    keeper.observe("act1:dag")
    keeper.observe("act1:workmate")
    await clock.runNext()
    expect(written).toEqual([])
    expect(csv).toBe("act1:team,act1:dag")
    expect(keeper.outcome().reasserted).toBe(0)
    expect(keeper.outcome().detail).toContain("standing down")
    expect(keeper.outcome().detail).toContain("act1:team,act1:dag")
    // The next tick reads the same user list and is a no-op again: the stand-down is not a one-off.
    await clock.runNext()
    expect(written).toEqual([])
  })

  test("the whole set goes in at once, so a partial write can never make the next tick stand down mid-repair", async () => {
    /** The CSV the fake host store holds. */
    let csv = "todo,jobs,agents"
    /** Every CSV the keeper wrote. */
    const written: string[] = []
    /** The stand-in store. */
    const store = {
      getSidePanelPanels: (): unknown => csv,
      applySidePanelPanels: (value: unknown): unknown => { csv = String(value); written.push(csv); return csv },
    }
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: store }), schedule: clock.schedule })
    keeper.observe("act1:team")
    keeper.observe("act1:dag")
    keeper.observe("act1:workmate")
    await clock.runNext()
    // ONE write carrying all three — never three writes, each of which would leave the list naming one
    // of us and make the FOLLOWING tick stand down with the repair half finished.
    expect(written.length).toBe(1)
    expect(csv).toBe("todo,jobs,agents,act1:team,act1:dag,act1:workmate")
    expect(keeper.outcome().reasserted).toBe(1)
  })

  test("the ladder is the WHOLE budget, and `stop()` releases every pending tick", async () => {
    /** A stand-in store that never needs a write. */
    const store = { getSidePanelPanels: (): unknown => "todo", applySidePanelPanels: (value: unknown): unknown => value }
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: store }), schedule: clock.schedule })
    keeper.observe("act1:team")
    // BOUNDED: exactly the ladder, never a recurring timer.
    expect(clock.delays).toEqual([...PANEL_KEEPER_LADDER_MS])
    keeper.stop()
    expect(clock.cancelled).toBe(PANEL_KEEPER_LADDER_MS.length)
  })

  test("NEGATIVE CONTROL: an ABSENT host store is reported as `absent`, never thrown, and writes nothing", async () => {
    /** Every CSV the keeper wrote; the control must leave this empty. */
    const written: string[] = []
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test, with a loader that reports the version-gated miss. */
    const keeper = createPanelEnableKeeper({
      loadPrefs: async () => ({ detail: "no candidate carried a readable lib/types/tuiDisplayPrefs.js" }),
      schedule: clock.schedule,
    })
    keeper.observe("act1:team")
    await clock.runNext()
    expect(keeper.outcome().state).toBe("absent")
    expect(keeper.outcome().detail).toContain("tuiDisplayPrefs.js")
    expect(written).toEqual([])
  })

  test("NEGATIVE CONTROL: a store that throws is recorded as `refused` and takes no boot down", async () => {
    /** A store whose reader throws, as a reshaped host build would. */
    const store = { getSidePanelPanels: (): unknown => { throw new Error("reshaped store") }, applySidePanelPanels: (value: unknown): unknown => value }
    /** The controllable clock. */
    const clock = fakeClock()
    /** The keeper under test. */
    const keeper = createPanelEnableKeeper({ loadPrefs: async () => ({ prefs: store }), schedule: clock.schedule })
    keeper.observe("act1:team")
    await clock.runNext()
    expect(keeper.outcome().state).toBe("refused")
    expect(keeper.outcome().detail).toContain("reshaped store")
  })

  test("the CONTACT itself binds the installed host and refuses an absent one", async () => {
    /** The contact against the INSTALLED host root — the same module the sidebar reads. */
    const bound = await probeHostPrefs([HOST])
    expect(bound.prefs).toBeDefined()
    expect(bound.root).toBe(HOST)
    // The read is the host's OWN store: an unedited boot answers exactly the schema default.
    expect(typeof bound.prefs?.getSidePanelPanels()).toBe("string")
    /** The contact against a root that carries nothing, which must be a REASON rather than a throw. */
    const missing = await probeHostPrefs([join(HOST, "no-such-subdirectory")])
    expect(missing.prefs).toBeUndefined()
    expect(missing.detail).toBeTruthy()
    // An empty candidate list is its own reason, never an empty success.
    const none = await probeHostPrefs([])
    expect(none.prefs).toBeUndefined()
  })
})

/**
 * A controllable clock: the keeper's ladder is scheduled, never fired, so the arm owns the timing.
 *
 * The keeper's own contract is "a bounded ladder"; a test that slept for 25 real seconds would be
 * both slow and flaky, and one that skipped the ladder would not test it at all.
 * @returns the schedule function, the delays it was asked for, and a driver for one tick.
 */
function fakeClock(): {
  readonly delays: number[]
  readonly cancelled: number
  readonly schedule: (run: () => void, delayMs: number) => () => void
  runNext: () => Promise<void>
} {
  /** The delays the keeper asked to be woken after, in order. */
  const delays: number[] = []
  /** The pending ticks, in scheduling order. */
  const pending: (() => void)[] = []
  /** How many pending ticks were cancelled. */
  let cancelled = 0
  return {
    delays,
    /** How many pending ticks `stop()` released, read by the boundedness arm. */
    get cancelled(): number { return cancelled },
    /** Schedules one tick and hands back its canceller; see {@link PanelEnableKeeperOptions.schedule}. */
    schedule: (run: () => void, delayMs: number): (() => void) => {
      delays.push(delayMs)
      pending.push(run)
      return (): void => { cancelled += 1 }
    },
    /** Fire the next pending tick and let the keeper's promise chain settle. */
    runNext: async (): Promise<void> => {
      /** The tick to run; an exhausted ladder runs nothing. */
      const run = pending.shift()
      run?.()
      // The tick's body is `loadPrefs().then(...)`: a few microtask turns are enough for it to land,
      // and they are deterministic whereas a real delay would not be.
      for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()
    },
  }
}
