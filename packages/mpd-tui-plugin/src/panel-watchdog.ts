// THE WATCHDOG PAGE — what the team watchdog observed, as its own sidebar panel.
//
// WHY A THIRD PANEL (frozen contract `.mpd/plans/watchdog-tui-panel.md` §1–§7). Today the only TUI
// surfaces for the watchdog are one status-line notice, one acknowledge dialog per attach, and one
// `HELD` row inside the board/team/subagents scenes — so an operator who is not reading
// `.mpd/team/watchdog/*.jsonl` cannot see WHICH incidents were recorded, on WHICH team, with WHICH
// cause, and whether the hold landed. This page is that view: per team its held state and phase, the
// `mpd-tui` unread count, and the incident rows, with the acknowledge/refresh/scroll keys.
//
// DATA SOURCE — THE SERVICE, NEVER THE STORE (frozen §6). Every read goes through the row's
// `WatchdogFrontDoor`, which is this package's single read side of the `mpdWatchdog` service
// (`view(reader, workspace)` / `acknowledge(reader, upTo, workspace)`, reader `mpd-tui`). This file
// imports no watchdog store module and no filesystem writer: the same invariant the front door's own
// header states, and the one the build pins from the emitted bytes (no `readFileSync`/`writeFileSync`
// may appear in `packages/mpd-tui-plugin/dist/index.js`). Only `import type` for the record SHAPES
// survives here, and it is erased at build time.
//
// DEGRADE, NEVER FAIL (frozen §5). No `mpdWatchdog` service ⇒ the explicit `watchdog: not available`
// state; no incidents ⇒ an explicit empty state; an unreadable view ⇒ the front door's empty view.
// NOTHING in this file throws out of a render path: the reader is called inside a contained try, and
// every string crosses `panel-core.ts`'s sanitizers before it reaches a `ui.Text`.
//
// THE PAGE NAMES NO `ctx.tui*` SERVICE. Registration and the open request go through the `TuiAdapter`
// (`packages/mpd-tui-adapter-plugin`), the ONE place a DSH-TUI service may be named (AGENTS.md §6).
import type { Log } from "./log.js"
import type { PanelRegistrationHandle, SeamOutcome, TuiAdapter } from "./types.js"
import { WATCHDOG_PANEL_MIN_COLUMNS, WATCHDOG_PANEL_SLUG } from "./dag-theme.js"
// THE SHARED CHROME, never a second implementation of it: the title row, the frame, the window and the
// scroll band are ONE definition (`panel-core.ts`), so the three MPD pages cannot drift apart.
import {
  clampScroll,
  PANEL_CHROME_ROWS,
  PANEL_TITLE_ROW_ROWS,
  panelContentWidth,
  panelFloorColumns,
  panelFrame,
  panelKeysArmed,
  panelKit,
  panelScrollKey,
  panelViewportBody,
  swallowWheelEvent,
  textRow,
  usePanelKeys,
  usePanelSize,
  usePanelTick,
  usePanelTitleRow,
  usePanelViewport,
  type PanelPropsLike,
} from "./panel-core.js"
import type { PanelPageOptions } from "./panel.js"
import { t } from "./i18n.js"
import type { WatchdogView } from "./watchdog.js"

/** The panel slug this page registers under; the host prefixes it with this activation's plugin id. */
export const WATCHDOG_PANEL_ID = WATCHDOG_PANEL_SLUG

/** The title the host stores and draws in the sidebar's own panel bar. */
export const WATCHDOG_PANEL_TITLE = "MPD watchdog"

/**
 * The descriptor's icon: EXACTLY ONE display cell, which is the host's own hard requirement.
 *
 * WHY `⚠` (U+26A0): the host's `dsh-adapter/panels.js` REJECTS a descriptor whose icon is not exactly
 * one display cell, and its seven built-ins already own `≡`, `▸`, `◆`, `ⓘ`, `∿`, `⌗` and `♥` while this
 * bundle's other two pages own `❖` and `⬢`. U+26A0 is one cell under the plugin's own
 * `sanitize.cellWidth` (it is outside every East-Asian wide range) AND under the host's own
 * `stringWidth` for the same reason — it carries text (not emoji) presentation by default, so no
 * variation selector widens it.
 */
export const WATCHDOG_PANEL_ICON = "⚠"

/** The ordering hint inside the host's panel bar: after the MPD panel (10) and the workmate page (12). */
export const WATCHDOG_PANEL_ORDER = 13

/** The tick this page re-reads the service on. A watchdog tick writes its own files on a timer. */
export const WATCHDOG_PANEL_REFRESH_MS = 2000

/** The row budget this page assumes when the host reports no height at all. */
const WATCHDOG_FALLBACK_ROWS = 24

/**
 * The panel descriptor, frozen at module scope.
 *
 * `apiVersion` is exactly 1 because the host refuses every other value, `id` is the single lowercase
 * slug the host requires, and `component` is filled per registration by {@link registerWatchdogPanel}
 * (it closes over this row's own live readers, which no module-scope constant could).
 */
export const WATCHDOG_PANEL_DESCRIPTOR_FROZEN = {
  /** The host's panel API version (0.13.0 accepts exactly 1). */
  apiVersion: 1,
  /** The single lowercase slug the host prefixes with this activation's plugin id. */
  id: WATCHDOG_PANEL_ID,
  /** The title the host stores and draws (non-empty, at most 80 cells). */
  title: WATCHDOG_PANEL_TITLE,
  /** The one-cell icon the host draws in its panel bar. */
  icon: WATCHDOG_PANEL_ICON,
  /** The sidebar width floor: an integer in the host's own 12..64 range, the same 28 as every page. */
  minColumns: WATCHDOG_PANEL_MIN_COLUMNS,
  /** The ordering hint inside the host's panel bar. */
  order: WATCHDOG_PANEL_ORDER,
} as const

/** One acknowledgement attempt's outcome, as the service reports it. */
export interface WatchdogAckResult {
  /** Whether the watermark moved. */
  readonly ok: boolean
  /** The watermark the service reports after the attempt. */
  readonly watermark: number
  /** Why the attempt failed, when it did. */
  readonly error?: string
}

/** The team head this page reads for the phase half; a structural subset of the team projection. */
export interface WatchdogTeamHead {
  /** The team's own id. */
  readonly id: string
  /** The derived phase word (`active` / `idle` / `staged`). */
  readonly phase: string
}

/**
 * What the watchdog page needs from the rest of the plugin.
 *
 * EVERY member is a live READ, resolved per render: the service binds asynchronously, and a page that
 * captured its answer at apply would show the state of the boot forever.
 */
export interface WatchdogPanelDeps {
  /** Whether the row config contributes this surface at all (the `panel` knob, default true). */
  enabled: boolean
  /** Whether the `mpdWatchdog` service is mounted right now (the front door's own answer). */
  available(): boolean
  /** The durable view for the `mpd-tui` reader in this workspace; never throws (the front door). */
  read(): WatchdogView
  /** Advances the `mpd-tui` watermark through the service; reports failure instead of pretending. */
  acknowledge(upTo: number): WatchdogAckResult
  /**
   * The current team projection, for the PHASE half of a held team's row.
   *
   * The watchdog service carries hold ids and incidents, not a roster phase: phase belongs to the team
   * record, so it is read through the SAME projection the other MPD pages use. Optional because a
   * composition without the team reader still gets every watchdog fact — the phase cell then prints
   * `?`, which is the honest answer rather than an invented word.
   */
  readTeam?(): WatchdogTeamHead | undefined
  /** Diagnostics: the file sink, never a terminal. */
  log: Log
}

/**
 * The relative age of one incident, in a language-neutral compact form.
 *
 * It is deliberately NOT an English sentence ("3 minutes ago"): the panel is bilingual, and a unit
 * suffix (`3m`) reads the same in both languages while a translated sentence would need its own
 * dictionary for a value that is already numeric.
 * @param at - the incident's epoch-ms stamp.
 * @param now - the render's clock.
 * @returns the compact age (`<1s`, `12s`, `3m`, `2h`, `4d`), or `?` for an unusable stamp.
 */
export function incidentAge(at: number, now: number): string {
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return "?"
  /** How long ago the incident was recorded, floored at zero for a clock that ran backwards. */
  const delta = Math.max(0, now - at)
  if (delta < 1000) return "<1s"
  if (delta < 60_000) return `${String(Math.floor(delta / 1000))}s`
  if (delta < 3_600_000) return `${String(Math.floor(delta / 60_000))}m`
  if (delta < 86_400_000) return `${String(Math.floor(delta / 3_600_000))}h`
  return `${String(Math.floor(delta / 86_400_000))}d`
}

/** One team row: its id, its held state and its phase (the contract's per-team line). */
export interface WatchdogTeamRow {
  /** The team's id, as the watchdog store names it. */
  readonly id: string
  /** Whether a durable hold currently names it. */
  readonly held: boolean
  /** The phase word, or `?` when no team projection could prove one. */
  readonly phase: string
}

/**
 * Project the per-team rows: the held teams plus every team an unread incident names, sorted.
 *
 * WHY THE INCIDENT TEAMS JOIN THE HELD ONES: an incident on a team whose hold already auto-released is
 * still something the operator must see — the contract's "per team" line is about the teams the
 * watchdog OBSERVED, not only the ones it still holds.
 * @param view - the durable view this render read.
 * @param readTeam - the optional team projection, called once per render.
 * @returns the team rows, sorted by id.
 */
export function watchdogTeamRows(view: WatchdogView, readTeam?: () => WatchdogTeamHead | undefined): WatchdogTeamRow[] {
  /** The ids to draw: holds first, then incident teams, deduplicated. */
  const ids = new Set<string>()
  for (const team of view.holds) ids.add(team)
  for (const record of view.unread) ids.add(record.teamId)
  /** The projection answered for THIS render, read once so every row sees one team's phase. */
  let team: WatchdogTeamHead | undefined
  try {
    team = readTeam?.()
  } catch {
    team = undefined
  }
  /** The rows, sorted so a rebuilt render does not reshuffle the list. */
  const rows: WatchdogTeamRow[] = []
  for (const id of [...ids].sort((left, right) => left.localeCompare(right))) {
    rows.push({ id, held: view.holds.includes(id), phase: team !== undefined && team.id === id ? team.phase : "?" })
  }
  return rows
}

/**
 * The one-line text of a team row.
 * @param row - the projected row.
 * @returns the localized line.
 */
export function watchdogTeamLine(row: WatchdogTeamRow): string {
  return row.held
    ? t("watchdog.panelTeamHeld", { team: row.id, phase: row.phase })
    : t("watchdog.panelTeamIdle", { team: row.id, phase: row.phase })
}

/** One incident's three drawn lines, already localized as far as they carry copy. */
export function watchdogIncidentLines(
  record: WatchdogView["unread"][number],
  now: number,
): { first: string; second: string; third: string } {
  // THE KIND AND CAUSE IDENTIFIERS ARE PRINTED VERBATIM: they are the contract's own vocabulary
  // (`warn`, `escalate`, `never-started`, `tool-expired`, `hold-auto-released`; `silence*`,
  // `tool-expired`, `hold-auto-released`), i.e. DATA a reader greps for — translating them would break
  // the correspondence with `.mpd/team/watchdog/incidents.jsonl`.
  /** Whether THIS reader's key is in the record's acknowledged list. */
  const acknowledged = record.acknowledgedBy.includes("mpd-tui")
  return {
    first: `${record.kind} · ${incidentAge(record.at, now)} · ${acknowledged ? "✓" : "○"}`,
    // The task/attempt halves are shown only when the record names them, so an incident with neither
    // does not print two empty placeholders at 28 columns.
    second: [record.teamId, record.taskId ?? "", record.attemptId ?? ""].filter((part) => part !== "").join(" · "),
    third: [
      t("watchdog.panelCause", { cause: record.cause.kind, ms: record.cause.ms }),
      t("watchdog.panelHold", { outcome: record.hold }),
      ...(record.cause.release === undefined ? [] : [t("watchdog.panelReleased", { how: record.cause.release })]),
    ].join(" · "),
  }
}

/**
 * Build the watchdog page component.
 * @param deps - the front door reads, the acknowledgement route and the optional team projection.
 * @param options - this page's own chrome (no full-screen surface exists; the control is omitted).
 * @returns a component matching the host's panel props contract.
 */
export function createWatchdogPanelComponent(deps: WatchdogPanelDeps, options?: PanelPageOptions): unknown {
  return function MpdTuiWatchdogPanel(props: PanelPropsLike): unknown {
    /** The host's React instance and ui kit, proved usable before a single hook runs. */
    const kit = panelKit(props?.React, props?.ui)
    if (kit === undefined) {
      // THE ONE EARLY EXIT, before any hook: a host that hands no usable React or ui kit renders
      // nothing rather than crash the reconciler.
      return null
    }
    /** The panel's measured geometry; the single geometry hook call of this component. */
    const measured = usePanelSize(kit.ui, panelFloorColumns("watchdog"))
    /** The cells this page may DRAW IN: the reported width minus the frame's own two border cells. */
    const contentCols = panelContentWidth(measured.cols)
    /** The acknowledgement's outcome line, re-set on every press (undefined before the first). */
    const flash = kit.React.useState(undefined)
    /** The flash text, when the state cell holds a string. */
    const flashText = typeof flash[0] === "string" ? (flash[0] as string) : undefined
    /** Writes the flash line. */
    const setFlash = flash[1] as (next: unknown) => void
    /** The page's explicit refresh trigger (`r`): its UPDATE is the re-render. */
    const refresh = kit.React.useState(0)
    /** Requests one fresh render. */
    const setRefresh = refresh[1] as (next: unknown) => void
    /** The newest incident stamp this page has already acknowledged, so a stale closure cannot ack twice. */
    const lastAck = kit.React.useRef(0)
    /** The live view for this render; an unavailable service and an unreadable read both fall to the empty view. */
    let view: WatchdogView
    /** Whether the service answered at all this render. */
    let available = false
    try {
      available = deps.available()
      view = available ? deps.read() : { holds: [], unread: [] }
    } catch {
      available = false
      view = { holds: [], unread: [] }
    }
    /** The per-team rows, with the phase half read through the optional projection. */
    const teams = watchdogTeamRows(view, deps.readTeam)
    /** Whether the page may receive keys right now. */
    const keysArmed = panelKeysArmed(props?.focused, props?.visible, props?.host)
    // THE PAGE OWNS A TICK: a sidebar panel is a passive surface, and the watchdog store changes on its
    // own timer rather than on a keypress.
    usePanelTick(kit, WATCHDOG_PANEL_REFRESH_MS, true)
    /** The window height this panel affords; the title row and footer are drawn outside it. */
    const windowRows = Math.max(1, (measured.rows ?? WATCHDOG_FALLBACK_ROWS) - PANEL_CHROME_ROWS - PANEL_TITLE_ROW_ROWS)
    /** The sizes the viewport hook and every later closure read; published by this render below. */
    const sizes = { contentRows: 1, viewportRows: 1 }
    /** The register's ONE scroll position: the key handler below drives it. */
    const viewport = usePanelViewport(kit, () => sizes)
    /** The acknowledge action, shared by the key handler; one call per press. */
    const acknowledgeShown = (): void => {
      if (!available) return
      /** The incidents on screen at the moment of the press. */
      const shown = view.unread
      if (shown.length === 0) {
        setFlash(t("watchdog.panelAckNoop"))
        return
      }
      /** The newest incident stamp currently shown — the watermark an acknowledge advances to. */
      const upTo = shown.reduce((max, record) => Math.max(max, record.at), 0)
      /** A press with nothing newer than the last acknowledged stamp writes nothing. */
      if (!Number.isFinite(upTo) || upTo <= (lastAck.current as number)) {
        setFlash(t("watchdog.panelAckNoop"))
        return
      }
      try {
        /** The service's own answer; a failure is reported, never swallowed or retried silently. */
        const result = deps.acknowledge(upTo)
        if (result.ok) {
          lastAck.current = Math.max(lastAck.current as number, upTo)
          setFlash(t("watchdog.panelAckDone", { n: shown.length }))
        } else {
          setFlash(t("watchdog.panelAckFailed", { error: result.error ?? "?" }))
        }
      } catch (error) {
        setFlash(t("watchdog.panelAckFailed", { error: String((error as Error)?.message ?? error) }))
      }
    }
    /** Register the keymap: `a` acknowledges, `r` refreshes, the arrows and `jk` scroll. */
    usePanelKeys(kit, props?.host, keysArmed, (event: unknown): void => {
      /** The press, narrowed by the shared core's own event shape. */
      const bare = event as { input?: unknown; key?: Record<string, unknown>; preventDefault?: () => void } | undefined
      if (bare === null || bare === undefined || typeof bare !== "object") return
      /** The page-only viewport keys first: they have no other meaning inside a panel. */
      const gesture = panelScrollKey(bare)
      if (gesture !== undefined) {
        if (typeof bare.preventDefault === "function") bare.preventDefault()
        if (gesture === "top") viewport.scrollTo(0)
        else if (gesture === "bottom") viewport.scrollTo(Number.MAX_SAFE_INTEGER)
        else viewport.scrollBy((gesture === "pageUp" ? -1 : 1) * viewport.viewportRows)
        return
      }
      /** The typed characters; an escape sequence arrives as `input`, a flag as `key`. */
      const input = typeof bare.input === "string" ? bare.input : ""
      /** The host's own key flags. */
      const flags = bare.key ?? {}
      /** Whether this press asks for an acknowledgement. */
      const wantsAck = input === "a" || input === "A"
      /** Whether this press asks for an explicit refresh. */
      const wantsRefresh = input === "r" || input === "R"
      /** Whether this press scrolls later in the list. */
      const forward = flags.downArrow === true || input === "j" || input === "J"
      /** Whether this press scrolls earlier in the list. */
      const backward = flags.upArrow === true || input === "k" || input === "K"
      if (!wantsAck && !wantsRefresh && !forward && !backward) return
      if (typeof bare.preventDefault === "function") bare.preventDefault()
      if (wantsAck) {
        acknowledgeShown()
        return
      }
      if (wantsRefresh) {
        setFlash(undefined)
        setRefresh(Date.now())
        return
      }
      viewport.scrollBy(forward ? 1 : -1)
    })

    // ── THE ROWS, in draw order ──────────────────────────────────────────────
    /** The rows this page draws above its pinned footer. */
    const children: unknown[] = []
    if (!available) {
      // THE ABSENT-SERVICE STATE (frozen §5): an explicit sentence, in the header's own position, so a
      // reader never mistakes "nothing happened" for "the watchdog is not mounted".
      children.push(textRow(kit, t("watchdog.panelAbsent"), { key: "absent", tone: "failed", maxCells: contentCols }))
      children.push(textRow(kit, t("watchdog.panelAbsentHint"), { key: "absent-hint", dim: true, maxCells: contentCols }))
    } else {
      children.push(
        textRow(kit, t("watchdog.panelHeader", { held: view.holds.length, unread: view.unread.length }), {
          key: "header",
          bold: true,
          tone: "chain",
          maxCells: contentCols,
        }),
      )
      for (const row of teams) {
        children.push(
          textRow(kit, watchdogTeamLine(row), {
            key: `team-${row.id}`,
            // A held team warns; a team that only appears because of an incident stays quiet.
            ...(row.held ? { tone: "blocked" } : { dim: true }),
            maxCells: contentCols,
          }),
        )
      }
      children.push(textRow(kit, t("watchdog.panelIncidents"), { key: "incidents", dim: true, bold: true, maxCells: contentCols }))
      if (view.unread.length === 0) {
        children.push(textRow(kit, t("watchdog.panelEmpty"), { key: "empty", dim: true, maxCells: contentCols }))
      } else {
        for (const record of view.unread) {
          /** This incident's three localized lines. */
          const lines = watchdogIncidentLines(record, Date.now())
          // THREE ROWS PER INCIDENT rather than one wrapped sentence: at the 28-column floor a single
          // line cannot carry kind, age, team, task, cause, hold outcome and ack state without the host
          // wrapping it, and a wrapped row inside a self-windowed page is exactly what breaks the frame.
          children.push(textRow(kit, lines.first, { key: `${record.id}-1`, bold: true, maxCells: contentCols }))
          children.push(textRow(kit, lines.second, { key: `${record.id}-2`, maxCells: contentCols }))
          children.push(textRow(kit, lines.third, { key: `${record.id}-3`, dim: true, maxCells: contentCols }))
        }
      }
    }
    if (flashText !== undefined) children.push(textRow(kit, flashText, { key: "flash", tone: "completed", maxCells: contentCols }))

    // ── THE SELF-WINDOWED BODY ──────────────────────────────────────────────
    /** The page's content height, the pinned header included. */
    const contentRows = Math.max(children.length, 1)
    /** The clamped band for this render, computed before the new sizes are published (as every page does). */
    const band = clampScroll(viewport.offset, contentRows, viewport.viewportRows)
    // Publish this render's measurements, which is what every getter and every later closure clamps against.
    sizes.contentRows = contentRows
    sizes.viewportRows = windowRows
    /** The visible slice of the rows, inside the page's own wheel handler. */
    const scrolled = kit.React.createElement(
      kit.ui.Box,
      { key: "scroll", flexDirection: "column", onWheel: (event: unknown): void => viewport.onWheel(event) },
      ...children.slice(band.offset, band.offset + windowRows),
    )
    /** The pinned footer: the keys this page handles and where the window sits. */
    const footer = textRow(
      kit,
      `${t("watchdog.panelKeys")}${viewport.overflow ? ` ${String(viewport.offset + 1)}/${String(viewport.max + 1)}` : ""} · ${t("watchdog.panelLegend")}`,
      { key: "keys", dim: true, maxCells: contentCols },
    )
    /** The visible slice plus its reserved gutter column. */
    const body = panelViewportBody(kit, [scrolled], viewport)
    /** This page's chrome row; `options.open` is forwarded only when the caller has a surface to offer. */
    const titleRow = usePanelTitleRow(kit, {
      key: "title",
      title: WATCHDOG_PANEL_TITLE,
      cols: contentCols,
      ...(options?.openFullscreen === undefined ? {} : { open: options.openFullscreen }),
    })
    // THE FRAME CARRIES THE WHEEL TOO, so one tick can never scroll this page AND the chat behind it.
    return panelFrame(kit, WATCHDOG_PANEL_TITLE, [titleRow, ...body, footer], {
      onWheel: (event: unknown): void => {
        swallowWheelEvent(event)
        viewport.onWheel(event)
      },
    })
  }
}

/** The watchdog page's own seam: its registration handle and the discovered host id. */
export interface WatchdogPanelSeam {
  /** Registers the page; `undefined` when the row config disabled this surface. */
  readonly panel: PanelRegistrationHandle | undefined
  /** Whether the page is registered right now (the seam is bound AND the registration confirmed). */
  registered(): boolean
  /** The FINAL host panel id, or undefined while it is unbound, refused or unread. */
  id(): string | undefined
  /** The registration outcome, as the row's own boot diagnostic reports it. */
  outcome(): SeamOutcome
}

/**
 * Register the watchdog page.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param deps - the front door reads, the acknowledgement route and the log.
 * @returns the page's seam; `panel` is undefined only when the row config disabled the surface.
 */
export function registerWatchdogPanel(tui: TuiAdapter, deps: WatchdogPanelDeps): WatchdogPanelSeam {
  // ONE registration, at apply: the adapter queues it until the seam binds and settles it as `absent` on
  // a host that never offers the panel seam, so this call is safe on every dsh-tui build. Every read is
  // a closure, resolved per render: the watchdog service binds after this line runs.
  const panel: PanelRegistrationHandle | undefined = deps.enabled
    ? tui.registerPanel({
        ...WATCHDOG_PANEL_DESCRIPTOR_FROZEN,
        component: createWatchdogPanelComponent(deps),
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
      return tui.skipped("panels", "the watchdog sidebar page is disabled by the mpd-tui row config (panel: false)").outcome()
    },
  }
}
