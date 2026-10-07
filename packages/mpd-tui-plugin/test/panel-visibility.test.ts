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
import { EventEmitter } from "node:events"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { PANEL_KEEPER_LADDER_MS, createPanelEnableKeeper, probeHostPrefs } from "../../mpd-tui-adapter-plugin/src/index.js"
import {
  createPanelComponent,
  PANEL_DESCRIPTOR_FROZEN,
  PANEL_FULLSCREEN_GLYPH,
  PANEL_ICON,
  PANEL_MIN_COLUMNS,
  PANEL_SLUG,
  PANEL_TITLE,
} from "../src/panel"
import { createDagPanelComponent, DAG_PANEL_DESCRIPTOR_FROZEN, DAG_PANEL_ICON, DAG_PANEL_TITLE } from "../src/panel-dag"
import { createWorkmatePanelComponent, WORKMATE_PANEL_DESCRIPTOR_FROZEN, WORKMATE_PANEL_ICON, WORKMATE_PANEL_TITLE } from "../src/panel-workmate"
import { cellWidth, clampCells } from "../src/sanitize"
import { toneColor } from "../src/panel-core"

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

// ── AC8/AC8b · MPD's own panel chrome (icons + the `⤢` full-screen control) ──────────────────────
//
// WHY THIS LIVES HERE. The rest of this file reads the INSTALLED host, and so do the first two arms
// below: the host's panel bar owns seven icons (`≡ ▸ ◆ ⓘ ∿ ⌗ ♥`) and REJECTS any registration whose
// icon is not exactly one display cell (`stringWidth(d.icon) !== 1`), so both facts are read from the
// host rather than restated. The render arms at the end need a component, and they bring their own
// minimal kit double because this file has no other reason to own one.
//
// WHY MPD DRAWS ITS OWN `⤢`. Measured on dsh-tui 0.13.0: `dsh-adapter/panels.js` freezes a plugin
// descriptor WITHOUT a `capabilities` field, while `components/sidePanel/SideColumn.js`'s `canExpand`
// reads `definition.capabilities?.fullscreen === true`. A plugin panel therefore NEVER gets the
// host's expansion control, and declaring the field would change nothing but the size of the lie.

/** The host's own panel-bar module: where the seven built-in tabs and their icons live. */
const BUILTIN_PANELS_PATH = join(HOST, "lib", "types", "components", "sidePanel", "builtinPanels.js")

/** The host's own panels adapter: where the one-cell icon rule and the frozen definition live. */
const PANELS_ADAPTER_PATH = join(HOST, "lib", "types", "dsh-adapter", "panels.js")

/**
 * The host's OWN cell measure, resolved the way the host itself resolves it.
 *
 * `createRequire` against the adapter's own file proves the dependency the host actually imports, so
 * this cannot silently measure with a different copy of the package than the one enforcing the rule.
 * @returns the host's `stringWidth` function.
 */
function hostStringWidth(): (value: string) => number {
  /** The host's own resolver, anchored at the file that enforces the rule. */
  const require = createRequire(PANELS_ADAPTER_PATH)
  /** The module the host imports (`import stringWidth from 'string-width'`). */
  const loaded = require("string-width") as { default?: (value: string) => number } | ((value: string) => number)
  /** The callable, however this build exports it. */
  const measure = typeof loaded === "function" ? loaded : loaded.default
  if (typeof measure !== "function") throw new Error("the installed host's string-width is not callable")
  return measure
}

/** The icons the host's own panel bar draws, read from its source. */
function hostBuiltinIcons(): string[] {
  return [...readFileSync(BUILTIN_PANELS_PATH, "utf8").matchAll(/icon:\s*'([^']+)'/gu)].map((match) => match[1])
}

describe("AC8 · each MPD page carries its OWN one-cell icon, and none borrows the host's", () => {
  test("the three icons measure ONE cell under BOTH measures — ours and the host's own", () => {
    /** The host's own measure, the one that decides whether a registration is accepted. */
    const stringWidth = hostStringWidth()
    // BOTH MEASURES ARE ASSERTED because they disagree about some symbols: this plugin's `cellWidth`
    // treats a CJK-width glyph as two cells, the host's `string-width` follows Unicode's East Asian
    // Width property — and the host's answer is the one that can silently turn a registration down.
    for (const icon of [PANEL_ICON, DAG_PANEL_ICON, WORKMATE_PANEL_ICON]) {
      expect(cellWidth(icon)).toBe(1)
      expect(stringWidth(icon)).toBe(1)
      // ONE CODE POINT IS NOT THE CLAIM — one CELL is: a wide glyph is one code point and two cells.
      expect([...icon]).toHaveLength(1)
    }
  })

  test("the seven built-in icons are read from the host, and none of the three MPD pages wears one", () => {
    /** The host's own tab icons. */
    const builtins = hostBuiltinIcons()
    // The collision this wave had to fix, named so a host that renames its tabs cannot make the arm
    // vacuous: `◆` (U+25C6) is the host's `agents` tab, and it was this bundle's workmate icon.
    expect(builtins).toContain("◆")
    expect(builtins.length).toBeGreaterThanOrEqual(6)
    for (const icon of [PANEL_ICON, DAG_PANEL_ICON, WORKMATE_PANEL_ICON]) {
      expect(builtins).not.toContain(icon)
    }
    // …and the three are distinct from EACH OTHER: three pages, three identities.
    expect(new Set([PANEL_ICON, DAG_PANEL_ICON, WORKMATE_PANEL_ICON]).size).toBe(3)
  })

  test("the merged page DECLARES its icon — it no longer falls back to the letter `M`", () => {
    // The host falls back to `title.slice(0, 1)` when a panel declares no icon, which is exactly the
    // `M` this arm exists to keep away: the descriptor must carry the module's own glyph.
    expect(PANEL_DESCRIPTOR_FROZEN.icon).toBe(PANEL_ICON)
    expect(PANEL_DESCRIPTOR_FROZEN.icon).not.toBe(PANEL_TITLE.slice(0, 1))
    expect(DAG_PANEL_DESCRIPTOR_FROZEN.icon).toBe(DAG_PANEL_ICON)
    expect(WORKMATE_PANEL_DESCRIPTOR_FROZEN.icon).toBe(WORKMATE_PANEL_ICON)
  })

  test("NO MPD descriptor declares `capabilities` — the host drops the field, so it would be a dead promise", () => {
    // The host's own definition, as it freezes one: the members are read from the adapter's source, so
    // the arm follows the host when it changes rather than pinning a shape this bundle hopes for.
    /** The adapter's source. */
    const source = readFileSync(PANELS_ADAPTER_PATH, "utf8")
    /** The definition literal the adapter freezes. */
    const definition = source.slice(source.indexOf("const definition = Object.freeze({"), source.indexOf("const ownerTag"))
    expect(definition).toContain("icon: d.icon")
    expect(definition).not.toContain("capabilities")
    // …and the host's expansion gate really does read the dropped field: the source of the rule is the
    // claim, and the plugin-side arm below is that no descriptor supplies it.
    /** The side-panel column, where `canExpand` lives. */
    const column = readFileSync(join(HOST, "lib", "types", "components", "sidePanel", "SidePanelColumn.js"), "utf8")
    expect(column).toContain("definition.capabilities?.fullscreen === true")
    for (const descriptor of [PANEL_DESCRIPTOR_FROZEN, DAG_PANEL_DESCRIPTOR_FROZEN, WORKMATE_PANEL_DESCRIPTOR_FROZEN]) {
      expect(Object.hasOwn(descriptor, "capabilities")).toBe(false)
    }
  })
})

// ── the render arms: a minimal kit double, local to this file ────────────────

/** One element as this file's kit double produces it. */
interface ChromeElement {
  /** The element type: the host component the page created it from. */
  type: unknown
  /**
   * The element's props, the React key included.
   *
   * The key is read from `props` because that is where the pages PUT it: every row is built as
   * `createElement(ui.Text, { key: "..." }, ...)`, and this double — like React itself — never
   * separates the key out of the object literal it was handed.
   */
  props: Record<string, unknown>
  /** The element's children. */
  children: unknown[]
}

/**
 * A minimal host kit double for a PANEL component: index-keyed hooks, no timers, a fixed geometry.
 *
 * `useEffect` is deliberately a no-op: the pages under test read their sources per render, so running
 * an effect would only schedule intervals this arm would then have to clean up.
 * @param columns - the panel width the host reports.
 * @returns the double's React instance and ui kit.
 */
function chromeKit(columns: number = 34): { React: Record<string, unknown>; ui: Record<string, unknown>; begin(): void } {
  /** Hook state, keyed by hook position. */
  const store = new Map<string, unknown>()
  /** The hook counter of the current render pass. */
  let index = 0
  /** The React double. */
  const React: Record<string, unknown> = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): ChromeElement => ({ type, props: props ?? {}, children }),
    useState: (initial: unknown): [unknown, (next: unknown) => void] => {
      /** This cell's key, derived from the hook position. */
      const key = `state:${index}`
      index += 1
      if (!store.has(key)) store.set(key, typeof initial === "function" ? (initial as () => unknown)() : initial)
      return [store.get(key), (next: unknown) => store.set(key, typeof next === "function" ? (next as (prev: unknown) => unknown)(store.get(key)) : next)]
    },
    useEffect: (): void => {
      index += 1
    },
    useRef: (initial: unknown): { current: unknown } => {
      /** This ref's key, derived from the hook position. */
      const key = `ref:${index}`
      index += 1
      if (!store.has(key)) store.set(key, { current: initial })
      return store.get(key) as { current: unknown }
    },
  }
  /** The ui kit double: the two proved components, a geometry hook and a divider. */
  const ui: Record<string, unknown> = {
    Box: (props: Record<string, unknown>): ChromeElement => ({ type: "Box", props, children: [] }),
    Text: (props: Record<string, unknown>): ChromeElement => ({ type: "Text", props, children: [] }),
    Divider: (props: Record<string, unknown>): ChromeElement => ({ type: "Divider", props, children: [] }),
    useTerminalSize: (): { columns: number; rows: number } => ({ columns, rows: 30 }),
  }
  return {
    React,
    ui,
    /**
     * Start a fresh render pass: the hook index is reset, the stored state is KEPT.
     *
     * Both halves matter. A double that never reset would hand every later pass a brand-new set of
     * state cells (the pages key them by hook position), so a hover would never be observed; a double
     * that also dropped the store could not model a re-render at all.
     */
    begin: (): void => {
      index = 0
    },
  }
}

/**
 * Render one panel page with the kit double, as a fresh pass.
 * @param kit - the kit the double hands the page.
 * @param component - the page component under test.
 * @param host - the host API object the page receives in its props.
 * @returns the rendered tree.
 */
function chromeRender(kit: { React: Record<string, unknown>; ui: Record<string, unknown>; begin(): void }, component: unknown, host: unknown): unknown {
  kit.begin()
  return (component as (props: unknown) => unknown)({ React: kit.React, ui: kit.ui, host })
}

/** The host API object every render arm hands its page: a curated snapshot with no subagents. */
const CHROME_HOST = { snapshot: () => ({ subagents: [] }) }

/**
 * Every element of a rendered tree, parents before children.
 * @param node - the tree (or one element/child list of it), of unknown shape.
 * @param out - the accumulator.
 * @returns the elements, in draw order.
 */
function chromeElements(node: unknown, out: ChromeElement[] = []): ChromeElement[] {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) chromeElements(child, out)
    return out
  }
  if (typeof node !== "object") return out
  /** This node as an element. */
  const element = node as ChromeElement
  out.push(element)
  for (const child of element.children ?? []) chromeElements(child, out)
  return out
}

/**
 * The first element carrying a React key.
 * @param tree - the rendered tree.
 * @param key - the key to find.
 * @returns the element, or undefined when nothing carries that key.
 */
function chromeByKey(tree: unknown, key: string): ChromeElement | undefined {
  return chromeElements(tree).find((element) => element.props?.key === key)
}

/**
 * Every character inside one node, nested spans joined with nothing.
 * @param node - the tree (or one element/child list of it).
 * @returns the node's text, as one string.
 */
function chromeText(node: unknown): string {
  if (node === null || node === undefined) return ""
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(chromeText).join("")
  /** This node as an element. */
  const element = node as ChromeElement
  return chromeText(element.props?.children) + chromeText(element.children ?? [])
}

/** A pointer event double: it records whether propagation was stopped. */
interface ChromeEvent {
  /** Whether the control stopped the event from reaching the host's own click handling. */
  stopped: boolean
  /** The host's own stopper, as an event carries it. */
  stopImmediatePropagation(): void
}

/**
 * A pointer event double.
 * @returns the event, with its stopper counted.
 */
function chromeEvent(): ChromeEvent {
  return {
    stopped: false,
    /**
     * The host's own stopper, implemented as an event implements it: it marks the object it was
     * CALLED ON.
     */
    stopImmediatePropagation(): void {
      // The counter is on the object the control was handed, which is what makes the assertion below
      // about the REAL path rather than about a spy the arm installed somewhere else.
      this.stopped = true
    },
  }
}

describe("AC8b · MPD's own `⤢` control, drawn in each page's title row", () => {
  test("the merged page draws the control, and a click opens ITS full-screen scene", () => {
    /** How many times the page's own opener ran. */
    let opened = 0
    /** The page under test, wired as `registerPanelSurface` wires it. */
    const component = createPanelComponent(() => undefined, { openFullscreen: () => { opened += 1; return true } }) as (props: unknown) => unknown
    /** The kit double. */
    const kit = chromeKit()
    /** The rendered tree. */
    const tree = chromeRender(kit, component, CHROME_HOST)
    /** The clickable control. */
    const control = chromeByKey(tree, "title-fullscreen")
    expect(control).toBeDefined()
    // THE GLYPH IS THE HOST'S OWN, and it is one cell wide.
    expect(chromeText(control)).toBe(PANEL_FULLSCREEN_GLYPH)
    expect(cellWidth(PANEL_FULLSCREEN_GLYPH)).toBe(1)
    // A REAL CONTROL: clickable, with the host PanelBar's own hover pair.
    expect(typeof control?.props.onClick).toBe("function")
    expect(typeof control?.props.onMouseEnter).toBe("function")
    expect(typeof control?.props.onMouseLeave).toBe("function")
    // RENDERED, NOT USED: the arm's own control — a page that opened its scene on render would open it
    // for every reader who merely looked at the sidebar.
    expect(opened).toBe(0)
    /** The pointer event the click carries. */
    const event = chromeEvent()
    ;(control?.props.onClick as (event: unknown) => void)(event)
    expect(opened).toBe(1)
    // The host's PanelBar stops the event so the panel column's own click-to-focus does not also fire.
    expect(event.stopped).toBe(true)
    // THE FOOTER NAMES IT: a control nobody is told about is a secret.
    expect(chromeText(tree)).toContain(`${PANEL_FULLSCREEN_GLYPH} fullscreen`)
  })

  test("the workmate page draws its own control, wired to the board scene", () => {
    /** How many times the page's own opener ran. */
    let opened = 0
    /** The page under test, over an empty shelf and wired as `registerWorkmatePanel` wires it. */
    const component = createWorkmatePanelComponent(() => ({ entries: [], archived: 0, root: "/tmp/mpd-home/.mpd/workmate", problems: [] }), {
      openFullscreen: () => { opened += 1; return true },
    }) as (props: unknown) => unknown
    /** The kit double. */
    const kit = chromeKit()
    /** The rendered tree. */
    const tree = chromeRender(kit, component, CHROME_HOST)
    /** The clickable control. */
    const control = chromeByKey(tree, "title-fullscreen")
    expect(control).toBeDefined()
    expect(chromeText(control)).toBe(PANEL_FULLSCREEN_GLYPH)
    ;(control?.props.onClick as (event: unknown) => void)(chromeEvent())
    expect(opened).toBe(1)
    // The `⤢` hint LEADS this page's footer, and it has to: the host clamps a row from its end, and
    // this page's footer also carries the scroll position.
    expect(chromeText(tree)).toContain(`${PANEL_FULLSCREEN_GLYPH} fullscreen · `)
  })

  test("the hover treatment is the host PanelBar's own: bold and accent over the pointer, dim at rest", () => {
    /** The page under test. */
    const component = createPanelComponent(() => undefined, { openFullscreen: () => true }) as (props: unknown) => unknown
    /** The kit double. */
    const kit = chromeKit()
    /** The control's glyph element on a fresh render of this page. */
    const glyph = (): ChromeElement | undefined => chromeByKey(chromeByKey(chromeRender(kit, component, CHROME_HOST), "title-fullscreen"), "title-glyph")
    // AT REST: the panel's dim tone, not bold — the same `inactive` the host draws.
    expect(glyph()?.props.bold).toBe(false)
    expect(glyph()?.props.color).toBe(toneColor("dim"))
    // UNDER THE POINTER: bold, in the accent tone — the host's own `expandHovered` treatment.
    /** The control whose hover the arm exercises. */
    const control = chromeByKey(chromeRender(kit, component, CHROME_HOST), "title-fullscreen")
    ;(control?.props.onMouseEnter as () => void)()
    expect(glyph()?.props.bold).toBe(true)
    expect(glyph()?.props.color).toBe(toneColor("focus"))
    // …AND BACK, so the state cannot stick on the way out.
    ;(chromeByKey(chromeRender(kit, component, CHROME_HOST), "title-fullscreen")?.props.onMouseLeave as () => void)()
    expect(glyph()?.props.bold).toBe(false)
    expect(glyph()?.props.color).toBe(toneColor("dim"))
  })

  test("the title row is drawn ABOVE the body and outside the page's own window", () => {
    /** The page under test. */
    const component = createPanelComponent(() => undefined, { openFullscreen: () => true }) as (props: unknown) => unknown
    /** The kit double. */
    const kit = chromeKit()
    /** The rendered tree. */
    const tree = chromeRender(kit, component, CHROME_HOST)
    /** The frame's children, in draw order. */
    const frame = chromeByKey(tree, "frame")
    expect(frame).toBeDefined()
    /** The keys of the frame's own children, in draw order. */
    const frameKeys = (frame?.children ?? []).map((child) => (child as ChromeElement | null)?.props?.key)
    // The title row is FIRST, before the windowed body — a control that scrolled away would be one the
    // reader cannot find twice.
    expect(frameKeys[0]).toBe("title")
    // The page's own title travels with the control, so the row reads as the panel's identity row.
    expect(chromeText(chromeByKey(tree, "title"))).toContain(PANEL_TITLE)
  })


  test("AT THE 28-COLUMN FLOOR the `⤢` hint SURVIVES — measured, with the pre-fix ordering as the negative control", () => {
    // The floor is the width the descriptor asks the host for, so 28 columns is the narrowest this page
    // is ever drawn at — and the host clamps a row from its END. That combination is the trap: the key
    // hints alone run past 40 cells, so a `⤢` hint that TRAILED them existed only at widths where the
    // reader needs it least. Both halves are measured here — the shipped ordering and the old one.
    /** The kit at the descriptor's own floor: 28 columns, i.e. 26 content cells inside the frame. */
    const kit = chromeKit(28)
    /** The page, wired as `registerDagPanel` wires it. */
    const component = createDagPanelComponent(() => undefined, { openFullscreen: () => true }) as (props: unknown) => unknown
    /** The rendered page. */
    const tree = chromeRender(kit, component, CHROME_HOST)
    /** The page's own text. */
    const text = chromeText(tree)
    // THE CONTROL IS THERE, and so is the hint that names it.
    expect(chromeByKey(tree, "title-fullscreen")).toBeDefined()
    expect(text).toContain(`${PANEL_FULLSCREEN_GLYPH} fullscreen`)
    /** The footer row itself, read by its own key. */
    const footer = chromeByKey(tree, "keys")
    expect(footer).toBeDefined()
    /** The footer as it was actually drawn. */
    const drawn = chromeText(footer)
    expect(drawn.startsWith(PANEL_FULLSCREEN_GLYPH)).toBe(true)
    expect(cellWidth(drawn)).toBeLessThanOrEqual(26)
    // NEGATIVE CONTROL: the PRE-FIX footer — the same hints in the old order, clamped by the same
    // rule this page's rows go through — loses the glyph entirely at this width. The arm above is
    // therefore a statement about the ORDER, not about the glyph being unavoidable.
    /** The footer as it was drawn before this repair. */
    const before = clampCells("↑↓/jk move · Enter pin · Esc unpin · ⤢ fullscreen", 26)
    expect(before).not.toContain(PANEL_FULLSCREEN_GLYPH)
  })
})

// ── AC8b, MEASURED BY A LAYOUT: the host's own ink, not a prop record ─────────────────────────────
//
// WHY THIS SECTION EXISTS. Every `⤢` arm above this one reads a React ELEMENT TREE: it proves that a
// control was created, carries a handler and is wired to the right dep — and it stayed green while the
// control occupied ZERO CELLS on a real terminal. The shipped row asked for `width: "100%"` inside a
// frame that is itself `width: "100%"` with a border, so the row laid out to the frame's BORDER box
// (28 cells) instead of its interior (26), its title grew over the whole row and the control was
// pushed past the right border and clipped. The real PTY found it; a prop-recording double CANNOT,
// because it records `width: "100%"` and `flexShrink: 0` faithfully and never turns them into cells.
//
// So these arms render the REAL page components through the INSTALLED host's own ink (the host vendors
// it under `lib/types/ink/**`) into a fake stdout and read the frame. The negative control re-creates
// the pre-fix row shape and shows the glyph disappearing at the same width — which is what makes the
// positive arms a statement about the layout rather than about the glyph being unavoidable.

/** A stdout double: a TTY-shaped stream that keeps every chunk the renderer wrote. */
class InkStdout extends EventEmitter {
  /** The columns this fake terminal reports. */
  columns: number
  /** The rows this fake terminal reports. */
  rows: number
  /** Every chunk written so far, in order. */
  chunks: string[] = []
  /**
   * Build the fake terminal at one geometry.
   *
   * `EventEmitter` is the base because the renderer subscribes to `resize`; no resize is ever emitted,
   * so the geometry the constructor was given is the one every frame is laid out for.
   * @param columns - the width the renderer lays out for.
   * @param rows - the height the renderer lays out for.
   */
  constructor(columns: number, rows: number) {
    super()
    this.columns = columns
    this.rows = rows
  }
  /** Accept one write, as a stream would. */
  write(chunk: string): boolean {
    this.chunks.push(String(chunk))
    return true
  }
  /** The frame as readable text: hyperlink and SGR escapes stripped, nothing else. */
  frame(): string {
    return this.chunks.join("").replace(/\u001b\][^\u0007]*\u0007/gu, "").replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, "")
  }
}

/** The host's React, themed components and ink root, loaded from the installed package. */
const hostReact = createRequire(join(HOST, "lib", "types", "ui.js"))("react") as {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
}
/** The host's own rendering surface, exactly the objects its panel adapter hands a plugin. */
const hostUi = (await import(join(HOST, "lib", "types", "ui.js"))) as { Box: unknown; Text: unknown; ThemeProvider: unknown }
/** The host's ink root, whose `createRoot` accepts a managed stdout. */
const hostInk = (await import(join(HOST, "lib", "types", "ink", "root.js"))) as {
  createRoot(options: Record<string, unknown>): Promise<{ render(node: unknown): void; unmount(): void }>
}

/**
 * Render one tree with the INSTALLED host's ink and return the frame's lines.
 * @param build - builds the element tree, given the host kit the pages receive.
 * @param columns - the terminal width the fake stdout reports.
 * @returns the frame, split into lines; ANSI escapes stripped.
 */
async function inkFrame(build: (props: { React: unknown; ui: unknown; host: unknown; focused: boolean; visible: boolean }) => unknown, columns: number): Promise<string[]> {
  /** The fake terminal. */
  const stdout = new InkStdout(columns, 14)
  /** The host's root over it. */
  const root = await hostInk.createRoot({ stdout, stdin: undefined, stderr: stdout, exitOnCtrlC: false, patchConsole: false, terminalImages: false })
  /** The kit the pages receive: the host's React, the host's components, a real geometry. */
  const ui = { Box: hostUi.Box, Text: hostUi.Text, useTerminalSize: () => ({ columns, rows: 14 }) }
  /** The host API a panel receives. */
  const host = { snapshot: () => ({ subagents: [] }), focused: true, visible: true, onKey: () => () => {} }
  /** The props a panel component receives: the kit, the host API and the two state flags. */
  const pageProps = { React: hostReact, ui, host, focused: true, visible: true }
  // THE HOST'S OWN THEME PROVIDER wraps the page, because `ui.Box`/`ui.Text` are the host's themed
  // components and read that context — the same context the host supplies in production.
  root.render(hostReact.createElement(hostUi.ThemeProvider, null, build(pageProps)))
  // ONE FRAME IS ENOUGH and the wait is the renderer's own commit; 80 ms is far past it.
  await new Promise((resolve) => setTimeout(resolve, 80))
  /** The frame as text, read before the root is torn down. */
  const frame = stdout.frame()
  root.unmount()
  return frame.split("\n")
}

/**
 * The page's title row from a frame: the first CONTENT row that carries the page's name.
 * @param lines - the frame's lines.
 * @param title - the page's title, as the row draws it.
 * @returns the row, or undefined when no content row carries it.
 */
function titleRowOf(lines: string[], title: string): string | undefined {
  // The frame's TOP BORDER also carries the title, and reading it would answer a different question.
  return lines.find((line) => line.startsWith("│") && line.includes(title))
}

describe("AC8b · the control OCCUPIES CELLS under the host's real layout engine", () => {
  test("each of the three pages draws `⤢` at the RIGHT EDGE of its title row — at 28 and at 40 columns", async () => {
    /** The three pages, each with the title its own frame carries and an opener wired. */
    const pages: Array<{ label: string; title: string; component: unknown }> = [
      { label: "merged MPD", title: PANEL_TITLE, component: createPanelComponent(() => undefined, { openFullscreen: () => true }) },
      { label: "MPD DAG", title: DAG_PANEL_TITLE, component: createDagPanelComponent(() => undefined, { openFullscreen: () => true }) },
      {
        label: "MPD workmate",
        title: WORKMATE_PANEL_TITLE,
        component: createWorkmatePanelComponent(() => ({ entries: [], archived: 0, root: "/tmp/mpd-home/.mpd/workmate", problems: [] }), { openFullscreen: () => true }),
      },
    ]
    for (const columns of [28, 40]) {
      for (const page of pages) {
        // THE PAGE IS RENDERED AS A COMPONENT, never called as a function: it uses hooks, and a plain
        // call would run them outside any renderer (`ReactSharedInternals.H` is null there).
        /** This page's frame at this width. */
        const lines = await inkFrame((pageProps) => hostReact.createElement(page.component as never, pageProps as never), columns)
        /** The content row that carries the page's name. */
        const row = titleRowOf(lines, page.title)
        expect(`${page.label}@${columns}:${row === undefined ? "no title row" : "row"}`).toBe(`${page.label}@${columns}:row`)
        if (row === undefined) continue
        /** The row as cells, so a column is a measurement rather than an index into a string. */
        const cells = [...row]
        expect(`${page.label}@${columns} glyph:${cells.includes(PANEL_FULLSCREEN_GLYPH)}`).toBe(`${page.label}@${columns} glyph:true`)
        // AT THE RIGHT EDGE: one cell inside the row's own right border, which is what "right-aligned"
        // has to mean in cells. The column is asserted rather than the mere presence, because a control
        // that floats in the middle of the row would satisfy "present" and not this.
        expect(`${page.label}@${columns} col:${cells.indexOf(PANEL_FULLSCREEN_GLYPH)}/${cells.length - 2}`).toBe(`${page.label}@${columns} col:${cells.length - 2}/${cells.length - 2}`)
      }
    }
  })

  test("NEGATIVE CONTROL: the pre-fix row shape LOSES the glyph at the same width — this is what the double could not see", async () => {
    /** The frame the pages draw in, rebuilt by hand so the control arm below has a real parent. */
    const frame = (row: unknown): unknown =>
      hostReact.createElement(
        hostUi.Box,
        { key: "frame", flexDirection: "column", width: "100%", height: "100%", borderStyle: "single", borderText: { content: PANEL_TITLE, position: "top", align: "start" } },
        row,
      )
    /** THE ROW THIS WAVE SHIPPED FIRST: `width: "100%"` on the row, a growing title, `marginLeft` on the control. */
    const before = frame(
      hostReact.createElement(
        hostUi.Box,
        { key: "title", flexDirection: "row", width: "100%", flexShrink: 0 },
        hostReact.createElement(hostUi.Box, { key: "t", flexGrow: 1, flexShrink: 1, overflow: "hidden" }, hostReact.createElement(hostUi.Text, { key: "tt" }, PANEL_TITLE)),
        hostReact.createElement(hostUi.Box, { key: "f", flexShrink: 0, marginLeft: 1 }, hostReact.createElement(hostUi.Text, { key: "g" }, PANEL_FULLSCREEN_GLYPH)),
      ),
    )
    /** The row the repair ships: auto width, `space-between`, the control in the same clickable Box. */
    const after = frame(
      hostReact.createElement(
        hostUi.Box,
        { key: "title", flexDirection: "row", justifyContent: "space-between", flexShrink: 0 },
        hostReact.createElement(hostUi.Box, { key: "t", flexShrink: 1, overflow: "hidden" }, hostReact.createElement(hostUi.Text, { key: "tt" }, PANEL_TITLE)),
        hostReact.createElement(hostUi.Box, { key: "f", flexShrink: 0 }, hostReact.createElement(hostUi.Text, { key: "g" }, PANEL_FULLSCREEN_GLYPH)),
      ),
    )
    /** The pre-fix frame at the floor width. */
    const beforeLines = await inkFrame(() => before, 28)
    /** The repaired frame at the same width. */
    const afterLines = await inkFrame(() => after, 28)
    /** The row the PRE-FIX frame drew under its border. */
    const beforeRow = titleRowOf(beforeLines, PANEL_TITLE)
    /** The row the REPAIRED frame drew under the same border. */
    const afterRow = titleRowOf(afterLines, PANEL_TITLE)
    expect(beforeRow).toBeDefined()
    expect(afterRow).toBeDefined()
    // THE CONTROL IS CLIPPED BY THE OLD SHAPE and PRESENT IN THE NEW ONE — same frame, same width, same
    // two children. The one difference is the row's own width claim.
    expect(beforeRow?.includes(PANEL_FULLSCREEN_GLYPH)).toBe(false)
    expect(afterRow?.includes(PANEL_FULLSCREEN_GLYPH)).toBe(true)
  })
})
