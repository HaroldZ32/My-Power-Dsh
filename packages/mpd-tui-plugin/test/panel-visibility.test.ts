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
