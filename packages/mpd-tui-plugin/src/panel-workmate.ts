// THE WORKMATE PAGE — the durable workmate library as its OWN sidebar panel (frozen clause R12).
//
// WHAT THE LIBRARY IS. `mpd-workmate-plugin` keeps durable, evolving agent instances under
// `$HOME/.mpd/workmate/<key>/`, one directory per instance: `meta.json` (its identity, base template,
// route, use count and timestamps), `note.md` (the short card the library matches on), `memory.md`
// and `persona.md` (the instance's own evolving state). This page READS that library and renders it;
// it writes nothing, and it is deliberately its own page rather than a section of the merged panel,
// because the library is a per-USER shelf rather than a per-workspace team.
//
// READ-ONLY BY CONSTRUCTION. Every filesystem call is contained: a missing library (the normal state
// before the first `mpd_workmate_init`), an unreadable directory, a hand-edited `meta.json`, an
// instance with no note — each costs a row or a field, never the page. Nothing here creates, mutates
// or archives an instance; the MUTATING surface is `mpd_workmate_*` (the tools), and a panel that
// could archive a library entry with one keystroke is a footgun, not a feature.
//
// THE EMPTY STATE NAMES THE CALL THAT FILLS IT (frozen clause R10): the library does not exist until
// something initializes it, so the empty page says `mpd_workmate_init` rather than "no data".
//
// IT REUSES THE SAME DISCIPLINES AS THE DAG PAGE: `panel-core.ts` for the narrowing, the one hook
// call, the frame and the sanitizers; `dag-theme.ts` for the chrome. It names NO `ctx.tui*` service —
// registration goes through the `TuiAdapter` (AGENTS.md §6).
import { lstatSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { PanelRegistrationHandle, SeamOutcome, TuiAdapter } from "./types.js"
import type { Log } from "./log.js"
import { DAG_CHROME, WORKMATE_PANEL_MIN_COLUMNS, WORKMATE_PANEL_SLUG } from "./dag-theme.js"
// THE CHROME COMES FROM THE SHARED CORE, not a second implementation of it: the `⤢` control, its
// hover treatment and the row it sits in are ONE definition, so the two MPD pages this bundle ships
// (the MPD panel and this workmate page) cannot drift into two different-looking affordances.
import { PANEL_FULLSCREEN_GLYPH, PANEL_TITLE_ROW_ROWS, usePanelTitleRow } from "./panel-core.js"
import type { PanelPageOptions } from "./panel.js"
import {
  clampScroll,
  PANEL_CHROME_ROWS,
  panelContentWidth,
  panelField,
  panelFloorColumns,
  panelFrame,
  panelKeysArmed,
  panelKit,
  panelScrollKey,
  panelText,
  panelViewportBody,
  textRow,
  usePanelKeys,
  usePanelSize,
  usePanelTick,
  usePanelViewport,
  type PanelPropsLike,
} from "./panel-core.js"

/** The panel slug this page registers under; the host prefixes it with this activation's plugin id. */
export const WORKMATE_PANEL_ID = WORKMATE_PANEL_SLUG

/** The title the host stores and draws in the sidebar's own panel bar. */
export const WORKMATE_PANEL_TITLE = "MPD workmate"

/**
 * The descriptor's icon: EXACTLY ONE display cell, which is the host's own hard requirement.
 *
 * WHY IT IS NOT `DAG_CHROME.pinMarker` (the `◆` U+25C6 this page used to declare) — measured on the
 * installed dsh-tui 0.13.0: the host's own panel bar draws `components/sidePanel/builtinPanels.js`,
 * whose seven tabs already own `≡` (U+2261), `▸` (U+25B8), `◆` (U+25C6), `ⓘ` (U+24D8), `∿` (U+223F),
 * `⌗` (U+2317) and `♥` (U+2665). `◆` is the host's AGENTS tab, so this page wore the host's own
 * badge and the tab strip could not be read. `⬢` (U+2B22) is one cell under the plugin's own
 * `sanitize.cellWidth` AND under the host's own `stringWidth` — both measured, because the host
 * REJECTS a registration whose icon is not exactly one cell and the two measures disagree about some
 * symbols. The pin marker stays the ENTRY marker inside this page's rows; it is only the panel's own
 * identity that had to stop borrowing it.
 */
export const WORKMATE_PANEL_ICON = "⬢"

/** The ordering hint inside the host's panel bar: after the merged panel (10) and the DAG page (11). */
export const WORKMATE_PANEL_ORDER = 12

/** The tick this page re-reads the library on. A library changes on a tool call, not on a keypress. */
export const WORKMATE_PANEL_REFRESH_MS = 2000

/**
 * The panel descriptor, frozen at module scope.
 *
 * `apiVersion` is exactly 1 because the host refuses every other value, `id` is the single lowercase
 * slug the host requires, and `component` is filled per registration by {@link registerWorkmatePanel}
 * (it closes over this row's own home resolver, which no module-scope constant could).
 */
export const WORKMATE_PANEL_DESCRIPTOR_FROZEN = {
  /** The host's panel API version (0.13.0 accepts exactly 1). */
  apiVersion: 1,
  /** The single lowercase slug the host prefixes with this activation's plugin id. */
  id: WORKMATE_PANEL_ID,
  /** The title the host stores and draws (non-empty, at most 80 cells). */
  title: WORKMATE_PANEL_TITLE,
  /** The one-cell icon the host draws in its panel bar. */
  icon: WORKMATE_PANEL_ICON,
  /** The sidebar width floor: an integer in the host's own 12..64 range. */
  minColumns: WORKMATE_PANEL_MIN_COLUMNS,
  /** The ordering hint inside the host's panel bar. */
  order: WORKMATE_PANEL_ORDER,
} as const

/** One library instance, as this page renders it. */
export interface WorkmateEntry {
  /** The DIRECTORY name, which is the instance key every `mpd_workmate_*` call addresses. */
  key: string
  /** The display name from `meta.json`, falling back to the directory key. */
  name: string
  /** The BASE specialist's functional name (`Deep Worker`), never its internal id. */
  base: string
  /** The one-line description, when the metadata carries one. */
  description?: string
  /** The note card's first line, which is what the library's own matcher prints. */
  note?: string
  /** How many times this instance has been used, when the metadata carries a finite number. */
  uses?: number
  /** The last-update timestamp, as recorded (the page does not invent a format). */
  updatedAt?: string
  /** Whether the instance's base is one of the read-only specialists. */
  readonlyBase: boolean
  /** `provider/model`, or the bare model, when the metadata records a route. */
  route?: string
}

/** The whole library, as this page renders it: the live instances and how many are archived. */
export interface WorkmateLibrary {
  /** The instances, newest-updated first. */
  entries: WorkmateEntry[]
  /** How many archived instances sit under `.archive/` — reported, never listed. */
  archived: number
  /** The library root this read used, so the page can say where it looked. */
  root: string
  /** Bounded notes about what could not be read. */
  problems: string[]
}

/** The row budget a page assumes when the host reports no height at all. */
const WORKMATE_FALLBACK_ROWS = 24

/**
 * Scroll the viewport the least amount that puts one row inside it.
 *
 * The same arithmetic the DAG page's own helper uses, deliberately: the shelf cursor and the DAG focus
 * obey ONE focus invariant, and two implementations of it is how two surfaces would start to disagree
 * about when a row counts as "in view".
 * @param viewport - this render's viewport (its `scrollTo` clamps).
 * @param row - the row to bring into view.
 */
function scrollRowIntoView(viewport: { offset: number; viewportRows: number; scrollTo: (next: number) => void }, row: number): void {
  if (row < viewport.offset) {
    viewport.scrollTo(row)
    return
  }
  if (row >= viewport.offset + viewport.viewportRows) viewport.scrollTo(row - viewport.viewportRows + 1)
}

/** The archive directory's name under the library root; archived instances are counted, not listed. */
const ARCHIVE_DIR = ".archive"

/** How many instances one read will describe; a library larger than this is truncated and says so. */
const MAX_ENTRIES = 200

/** How many note characters one row shows; the full note belongs to the workmate's own tools. */
const NOTE_CELLS = 120

/**
 * Read one JSON file defensively.
 * @param path - the file to read.
 * @returns the parsed value, or undefined for a missing/unreadable/non-object file.
 */
function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    /** The parsed value; a throw here is the caller's "unreadable" signal. */
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * Read one text file's first non-empty line.
 * @param path - the file to read.
 * @returns the sanitized line, or undefined when the file is missing or carries no content.
 */
function readFirstLine(path: string): string | undefined {
  try {
    /** The file's content; each line is trimmed so a markdown heading prefix does not dominate a row. */
    const lines = readFileSync(path, "utf8").split("\n")
    for (const line of lines) {
      /** The line without its markdown decoration, so a `# name` note reads as `name`. */
      const bare = line.replace(/^[#>\s*-]+/u, "").trim()
      if (bare === "") continue
      /** The sanitized line, clamped to the row's own budget. */
      const shown = panelField(bare, NOTE_CELLS)
      if (shown !== undefined && shown !== "") return shown
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Read one instance directory.
 *
 * An instance is ADDRESSABLE only when it carries a `meta.json` — the same rule
 * `mpd-workmate-plugin`'s own `resolveTarget` applies, so a half-created or orphan directory is not
 * listed as a workmate the tools could not then address.
 * @param root - the library root.
 * @param key - the directory name (the instance key).
 * @returns the entry, or undefined for a directory that is not an instance.
 */
function readEntry(root: string, key: string): WorkmateEntry | undefined {
  /** The instance's directory. */
  const dir = join(root, key)
  // `lstatSync` is called for the DIRECTORY ITSELF as well as its `meta.json`: a symlinked instance is
  // a legitimate library member to READ, and the distinction between "a link" and "a missing file" is
  // what makes the orphan note below true rather than a guess.
  try {
    lstatSync(dir)
  } catch {
    return undefined
  }
  /** The instance's metadata; without it the directory is not an instance. */
  const meta = readJsonObject(join(dir, "meta.json"))
  if (meta === undefined) return undefined
  /** The note card's first line, when the instance has one. */
  const note = readFirstLine(join(dir, "note.md"))
  /** The directory key as displayed; the directory name IS the instance key (A3). */
  const shownKey = panelField(key, 60) ?? key
  /** The display name, falling back to the key: `meta.name` is a mirror, never the identity. */
  const name = panelField(meta.name, 60) ?? shownKey
  /** The base specialist's functional name, which is the only base identity a GUI may show. */
  const base = panelField(meta.baseName, 60)
  /** The description, when the metadata carries one. */
  const description = panelField(meta.description, 120)
  /** The last-update timestamp, in whatever form the record holds it. */
  const updatedAt = panelField(meta.updatedAt, 40)
  /** The route, joined only when at least one half is present. */
  const provider = panelField(meta.provider, 40)
  /** The model half of the instance's route, absent when the metadata records no model. */
  const model = panelField(meta.model, 60)
  /** The route text, or undefined when the metadata records neither half. */
  const route = model === undefined ? provider : provider === undefined ? model : `${provider}/${model}`
  return {
    key: shownKey,
    name,
    base: base === undefined || base === "" ? "(unknown base)" : base,
    ...(description === undefined ? {} : { description }),
    ...(note === undefined ? {} : { note }),
    ...(typeof meta.uses === "number" && Number.isFinite(meta.uses) ? { uses: Math.max(0, Math.floor(meta.uses)) } : {}),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    readonlyBase: meta.readonly === true,
    ...(route === undefined || route === "" ? {} : { route }),
  }
}

/**
 * Read the whole workmate library.
 *
 * SORTED NEWEST-UPDATED FIRST, the same order `mpd_workmate_list` serves, so the panel and the tool
 * describe one shelf the same way; an instance with no recorded timestamp sorts by its key instead of
 * disappearing from the order.
 * @param home - the home directory whose `.mpd/workmate` is the library.
 * @returns the projection; never throws, and an absent library is an empty one.
 */
export function readWorkmateLibrary(home: string): WorkmateLibrary {
  /** The library root for this home. */
  const root = join(panelField(home, 400) ?? "", ".mpd", "workmate")
  /** Bounded notes about what could not be read. */
  const problems: string[] = []
  /** Every directory under the root, or an empty list when the library does not exist yet. */
  let keys: string[] = []
  try {
    keys = readdirSync(root, { withFileTypes: true })
      // A SYMLINK IS DESCRIBED TOO (`mpd_workmate_*` refuses to mutate through one, and a panel that
      // hid it would leave the user with a library entry no tool will address); every candidate is then
      // decided by `meta.json` in `readEntry`, so a link to a real instance lists and a broken one is
      // reported as an orphan rather than silently dropped.
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith("."))
      .map((entry) => entry.name)
  } catch {
    // THE NORMAL FIRST-RUN CASE: no library directory exists until something initializes one, and an
    // absent shelf is not a problem to report — the empty state says how to fill it.
    return { entries: [], archived: 0, root, problems }
  }
  /** The entries, read one directory at a time. */
  const entries: WorkmateEntry[] = []
  for (const key of keys) {
    if (entries.length >= MAX_ENTRIES) {
      problems.push(`library truncated at ${MAX_ENTRIES} instances`)
      break
    }
    try {
      /** This directory's entry, undefined when it is not an addressable instance. */
      const entry = readEntry(root, key)
      if (entry === undefined) {
        // An orphan directory (no meta.json) is NOT an instance: listing it would offer a key every
        // `mpd_workmate_*` call would refuse.
        problems.push(`${panelField(key, 40) ?? "?"}: no meta.json (orphan directory)`)
        continue
      }
      entries.push(entry)
    } catch {
      problems.push(`${panelField(key, 40) ?? "?"}: unreadable`)
    }
  }
  entries.sort((left, right) => {
    /** The two timestamps, compared as text — the recorded form is ISO-8601, so text order is time order. */
    const byTime = (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "")
    return byTime !== 0 ? byTime : left.key.localeCompare(right.key)
  })
  /** How many archived instances sit beside the live ones. */
  let archived = 0
  try {
    archived = readdirSync(join(root, ARCHIVE_DIR), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
  } catch {
    archived = 0
  }
  return { entries, archived, root, problems }
}

/**
 * The header's own facts for one render: how many instances, how many archived, and where they live.
 * @param library - the projection.
 * @param cols - the cells the header row may use.
 * @returns the header text, already clamped.
 */
function headerLine(library: WorkmateLibrary, cols: number): string {
  /** The counts sentence, which is the row's own reason to exist. */
  const counts = `${library.entries.length} instance${library.entries.length === 1 ? "" : "s"}${library.archived > 0 ? ` · ${library.archived} archived` : ""}`
  /** The read-only sentence: this page never writes to the shelf. */
  return panelText(`${counts} · read-only`, cols)
}

/**
 * One instance's rows: its name and key, its base, its note and its own facts.
 * @param entry - the instance.
 * @param cols - the cells available.
 * @returns the rows, in print order.
 */
function entryLines(entry: WorkmateEntry, cols: number): string[] {
  /** The instance's identity row: the contract's pin marker, the name, and the key it is addressed by. */
  const title = `${DAG_CHROME.pinMarker} ${entry.name} · ${entry.key}`
  /** The base and route row, which is what says WHICH specialist this instance evolves. */
  const base = `base ${entry.base}${entry.readonlyBase ? " (read-only)" : ""}${entry.route === undefined ? "" : ` · ${entry.route}`}`
  /** The usage row, which is what says whether the instance is actually being reused. */
  const uses = `uses ${entry.uses ?? 0}${entry.updatedAt === undefined ? "" : ` · updated ${entry.updatedAt}`}`
  /** The rows, always in the same order so a rebuilt render does not reshuffle the shelf. */
  const rows = [title, base, uses]
  if (entry.description !== undefined && entry.description !== "") rows.push(entry.description)
  if (entry.note !== undefined) rows.push(entry.note)
  return rows.map((row) => panelText(row, cols))
}

/**
 * Build the workmate page component.
 * @param readLibrary - reads the library for the current home, per render. It is injected (rather than
 *   imported) so this file stays free of the plugin that owns the library's mutations, and so the page
 *   can be driven from a fixture in a test without touching a real home.
 * @param options - this page's own chrome: the full-screen opener its `⤢` control calls (the board
 *   scene, which already lists the library). Optional, so a caller that only wants the shelf still
 *   gets a component; the registered page always passes one, so the control the user sees is wired.
 * @returns a component matching the host's panel props contract.
 */
export function createWorkmatePanelComponent(readLibrary: () => WorkmateLibrary, options?: PanelPageOptions): unknown {
  return function MpdTuiWorkmatePanel(props: PanelPropsLike): unknown {
    /** The host's React instance and ui kit, proved usable before a single hook is called. */
    const kit = panelKit(props?.React, props?.ui)
    if (kit === undefined) {
      // THE ONE EARLY EXIT, before any hook: a host that hands no usable React or ui kit renders
      // nothing rather than crash the reconciler, and the hook order below never moves on a host that
      // did pass this gate.
      return null
    }
    /** The panel's measured geometry; the single geometry hook call of this component. */
    const measured = usePanelSize(kit.ui, panelFloorColumns("workmate"))
    /** The cells this page may DRAW IN: the reported width minus the frame's own two border cells. */
    const contentCols = panelContentWidth(measured.cols)
    /** The library for this render, read PER RENDER so the shelf is never a stale copy. */
    let library: WorkmateLibrary
    try {
      library = readLibrary()
    } catch {
      // An unreadable home costs the list, never the page: the header says `0 instances` and the empty
      // state still names the call that fills the shelf.
      library = { entries: [], archived: 0, root: "", problems: ["library unreadable"] }
    }
    /** The keyboard cursor: the key of the instance the reader has walked to. */
    const cursor = kit.React.useState(undefined)
    /** The instance key under the cursor, when the state cell holds one. */
    const cursorKey = typeof cursor[0] === "string" ? (cursor[0] as string) : undefined
    /** Moves the cursor. */
    const setCursor = cursor[1] as (next: unknown) => void
    /** Whether the page may receive keys right now. */
    const keysArmed = panelKeysArmed(props?.focused, props?.visible, props?.host)
    // THE PAGE OWNS A TICK (same reason as the DAG page): nothing else re-renders a sidebar panel, and
    // the library changes on a TOOL call rather than on a keypress.
    usePanelTick(kit, WORKMATE_PANEL_REFRESH_MS, true)
    /** The instance keys, in DRAWING order, which is the order the keyboard walks. */
    const order: string[] = library.entries.map((entry) => entry.key)
    /** Where each instance's FIRST row is drawn, for the focus auto-scroll below. */
    const rowIndex = new Map<string, number>()
    /** The page's self-windowed viewport: the same single-offset device the DAG page uses. */
    /** The sizes the hook and every later closure read; written by this render, before anything reads it. */
    const sizes = { contentRows: 1, viewportRows: 1 }
    /** The window height this panel affords, from the height the host reported (its title row and footer
     * are drawn OUTSIDE the window, which is why they are subtracted here). */
    const windowRows = Math.max(1, (measured.rows ?? WORKMATE_FALLBACK_ROWS) - PANEL_CHROME_ROWS - PANEL_TITLE_ROW_ROWS)
    /** The shelf's ONE scroll position: the cursor's auto-scroll and the page keys both drive it. */
    const viewport = usePanelViewport(kit, () => sizes)
    /** Register the keymap: `↑↓`/`jk` walk the shelf, and a key this page does not handle is left to the host. */
    usePanelKeys(kit, props?.host, keysArmed, (event: unknown): void => {
      /** The press, narrowed by the shared core so every page reads the host's flags the same way. */
      const bare = event as { input?: unknown; key?: Record<string, unknown>; preventDefault?: () => void } | undefined
      if (bare === null || bare === undefined || typeof bare !== "object") return
      // THE VIEWPORT KEYS FIRST, exactly as the DAG page orders them: a page key has no other meaning in
      // a panel, so it can never steal a key the shelf cursor needs.
      /** The scroll gesture this press asked for, if any. */
      const gesture = panelScrollKey(bare)
      if (gesture !== undefined) {
        if (typeof bare.preventDefault === "function") bare.preventDefault()
        if (gesture === "top") viewport.scrollTo(0)
        else if (gesture === "bottom") viewport.scrollTo(Number.MAX_SAFE_INTEGER)
        else viewport.scrollBy((gesture === "pageUp" ? -1 : 1) * viewport.viewportRows)
        return
      }
      /** The host's key flags, when this event carried any. */
      const flags = bare.key ?? {}
      /** The typed characters. */
      const input = typeof bare.input === "string" ? bare.input : ""
      /** Whether this press moves the cursor later in the list. */
      const forward = flags.downArrow === true || input === "j" || input === "J"
      /** Whether this press moves the cursor earlier in the list. */
      const backward = flags.upArrow === true || input === "k" || input === "K"
      if (!forward && !backward) return
      if (order.length === 0) return
      if (typeof bare.preventDefault === "function") bare.preventDefault()
      /** Where the cursor sits now, or -1 when it has not entered the list yet. */
      const at = cursorKey === undefined ? -1 : order.indexOf(cursorKey)
      /** The index the cursor moves to: the first row when it is not on the shelf yet, else wrapped. */
      const next = at < 0 ? (forward ? 0 : order.length - 1) : (at + (forward ? 1 : -1) + order.length) % order.length
      setCursor(order[next])
      // THE CURSOR CAN NEVER LEAVE THE SCREEN: the same invariant the DAG page's focus carries.
      /** The row the newly focused instance draws on. */
      const row = rowIndex.get(order[next])
      if (row !== undefined) scrollRowIntoView(viewport, row)
    })

    /** The rows, in draw order. */
    const children: unknown[] = [textRow(kit, headerLine(library, contentCols), { key: "header", dim: true, maxCells: contentCols })]
    if (library.entries.length === 0) {
      // THE EMPTY STATE NAMES THE CALL THAT FILLS IT (R10): this is the normal state before the first
      // instance exists, and the reader must be told which tool creates one.
      children.push(textRow(kit, "no workmates yet — `mpd_workmate_init` creates one", { key: "empty", dim: true, maxCells: contentCols }))
      if (library.root !== "") children.push(textRow(kit, `library ${library.root}`, { key: "root", dim: true, maxCells: contentCols }))
    } else {
      for (const entry of library.entries) {
        /** Whether this instance is the one the keyboard has reached. */
        const focused = entry.key === cursorKey
        /** This entry's rows. */
        const rows = entryLines(entry, contentCols)
        // The cursor auto-scroll target: the FIRST row of this instance, which is where its identity is
        // drawn — the same "one row per entry" mapping the DAG page keeps for its tasks.
        rowIndex.set(entry.key, children.length)
        for (let index = 0; index < rows.length; index += 1) {
          children.push(
            textRow(kit, rows[index], {
              key: `${entry.key}-${index}`,
              // The FIRST row of an entry is its identity, so it carries the emphasis; the cursor adds
              // the contract's focus marker in front of it, which is the same reading the DAG page's
              // focus uses.
              bold: index === 0,
              dim: index !== 0,
              ...(index !== 0 ? {} : { tone: focused ? "focus" : "chain" }),
              maxCells: contentCols,
            }),
          )
        }
        // A blank row separates two entries, so a note's last line is not read as the next entry's
        // title. It is pushed as an EMPTY host row rather than a sanitized one: `panelText("")` is `""`
        // anyway, and a `Text` with no content is one cell-high and costs nothing.
        children.push(kit.React.createElement(kit.ui.Text, { key: `${entry.key}-gap` }, ""))
      }
      // THE PROBLEMS COME LAST and are REPORTED rather than hidden: an orphan directory or a truncated
      // library is a fact about the shelf the reader can act on, and a page that silently dropped it
      // would make a damaged library look like an empty one.
      // THE SAME POSITION-KEY RULE THE DAG PAGE'S LISTS USE: two problems that agree for the key's whole
      // length would collide on one React key, and a collided key makes React draw the row again on every
      // re-render rather than updating it. A problem string is host-controlled path text, so agreement
      // over a 24-character prefix is ordinary rather than exotic; the position cannot collide at all.
      /** The problem row being pushed, so the key is the position and cannot collide. */
      let problemRow = 0
      for (const problem of library.problems) {
        children.push(textRow(kit, problem, { key: `p-${problemRow}`, tone: "failed", maxCells: contentCols }))
        problemRow += 1
      }
    }
    // ── THE SELF-WINDOWED BODY ──────────────────────────────────────────────
    // The same device as the DAG page, for the same reason: the host's `ScrollBox` `ref` is stripped
    // from the panel kit, so this page cannot read a position it does not own. The header is pinned, the
    // shelf scrolls through this page's own single `offset`, and the footer is pinned.
    /** The page's content height, the pinned header included. */
    const contentRows = Math.max(children.length, 1)
    /** The clamped band for this render. */
    const band = clampScroll(viewport.offset, contentRows, viewport.viewportRows)
    /** This render's viewport, with the band the REAL row count produces. */
    // Publish this render's measurements, which is what every getter and every later closure clamps against.
    sizes.contentRows = contentRows
    sizes.viewportRows = windowRows
    /** The same handle, named for what it does here: the window this render draws. */
    const scroller = viewport
    /** The visible slice of the shelf, inside the page's own wheel handler (the slice is taken on the
     * page's own rows, so `rowIndex`'s numbers stay indices into exactly this array). */
    const scrolled = kit.React.createElement(kit.ui.Box, { key: "scroll", flexDirection: "column", onWheel: (event: unknown): void => scroller.onWheel(event) }, ...children.slice(viewport.offset, viewport.offset + viewport.viewportRows))
    /** The pinned footer: the `⤢` hint FIRST (a 26-cell row is clamped from its END, so a trailing hint
     * would be the first thing the host cut at the width this page asks for), then the keys it handles
     * and where the shelf is. */
    const footer = textRow(kit, `${PANEL_FULLSCREEN_GLYPH} fullscreen · ↑↓/jk move · PgUp/PgDn${scroller.overflow ? ` ${scroller.offset + 1}/${scroller.max + 1}` : ""}`, { key: "keys", dim: true, maxCells: contentCols })
    /** The visible slice plus its reserved gutter column. */
    const body = panelViewportBody(kit, [scrolled], scroller)
    // THE TITLE ROW IS OUTSIDE THE WINDOW, immediately under the frame's top border: the page's own
    // name and MPD's `⤢`, both pinned, so the control is at the same cell however far the shelf scrolls.
    /** This page's chrome row: its title and the full-screen control. */
    const titleRow = usePanelTitleRow(kit, { key: "title", title: WORKMATE_PANEL_TITLE, cols: contentCols, ...(options?.openFullscreen === undefined ? {} : { open: options.openFullscreen }) })
    return panelFrame(kit, WORKMATE_PANEL_TITLE, [titleRow, ...body, footer])
  }
}

/** What the workmate page needs from the rest of the plugin. */
export interface WorkmatePanelDeps {
  /** Whether the row config contributes this surface at all (the `panel` knob, default true). */
  enabled: boolean
  /** The user's home directory; the library lives under it by design, and it is resolved per call. */
  home(): string
  /** The existing full-screen scene, opened when the host cannot serve a panel at all. */
  openScene(): boolean
  /** Diagnostics: the file sink, never a terminal. */
  log: Log
}

/** The workmate page's seam: the registration plus the facts the boot diagnostic reports. */
export interface WorkmatePanelSeam {
  /** The registration; `undefined` when the row config disabled this surface. */
  readonly panel: PanelRegistrationHandle | undefined
  /** Whether the page is registered right now (the seam is bound AND the registration confirmed). */
  registered(): boolean
  /** The FINAL host panel id, or undefined while it is unbound, refused or unread. */
  id(): string | undefined
  /** The registration outcome, as the row's own boot diagnostic reports it. */
  outcome(): SeamOutcome
  /** Opens the full-screen workmate/list scene; the surface a host without the panel seam keeps. */
  openScene(): boolean
}

/**
 * Register the workmate page and expose the route a host without the panel seam keeps.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param deps - the home resolver, the scene opener and the log.
 * @returns the page's seam; `panel` is undefined only when the row config disabled the surface.
 */
export function registerWorkmatePanel(tui: TuiAdapter, deps: WorkmatePanelDeps): WorkmatePanelSeam {
  // ONE registration, at apply: the adapter queues it until the seam binds and settles it as `absent`
  // on a host that never offers the panel seam, so this call is safe on every dsh-tui build. The home
  // is resolved PER READ, never cached at apply: one host serves many sessions and the library's root
  // belongs to whoever is looking.
  const panel: PanelRegistrationHandle | undefined = deps.enabled
    ? tui.registerPanel({
        ...WORKMATE_PANEL_DESCRIPTOR_FROZEN,
        // The `⤢` control the page draws itself calls THIS opener — the same full-screen surface the
        // page's own routed open falls back to, so the button and the fallback cannot name two surfaces.
        component: createWorkmatePanelComponent(() => readWorkmateLibrary(deps.home()), { openFullscreen: () => deps.openScene() }),
      })
    : undefined
  return {
    panel,
    registered: (): boolean => panel !== undefined && panel.id() !== undefined,
    id: (): string | undefined => panel?.id(),
    outcome: (): SeamOutcome => {
      if (panel !== undefined) return panel.outcome()
      // A surface this row deliberately did not activate: the adapter's own skipped vocabulary, so the
      // aggregate line names the reason instead of an invented state.
      return tui.skipped("panels", "the workmate sidebar page is disabled by the mpd-tui row config (panel: false)").outcome()
    },
    openScene: (): boolean => deps.openScene(),
  }
}
