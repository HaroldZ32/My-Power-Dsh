#!/usr/bin/env bun
// WIDTH MATRIX CAPTURE — the real-PTY half of the reviewer's R13 evidence.
//
// WHO WROTE THIS. The reviewer (`fidelity-verifier`), not an implementation lane. It drives the
// REPO'S OWN harness (`skills/dsh-qa/scripts/lib/tui-lane.ts`, the same `runTuiSession` the shipped
// `tui-mount` / `tui-panels` cases use) rather than a private tmux wrapper, so the captures it writes
// are produced by the exact lifecycle the repo already trusts: sandbox `DSH_HOME`, sandbox `HOME`,
// sandbox workspace `ws/`, private tmux socket, pane capture via `capture-pane -p -J`.
//
// WHY WIDTH IS THE VARIABLE. The sidebar is the HOST's surface: `resolveSidePanelGeometry` returns
// null unless `canSplit(columns)` holds (`CHAT_MIN_COLUMNS 64 + PANEL_MIN_COLUMNS 28 + DIVIDER 1`),
// and `PanelHost` paints its own `panel-too-narrow` string when a panel's declared `minColumns`
// exceeds the width it is allotted. So the same boot at the same revision can render the DAG, render
// "too narrow", or render no sidebar at all — purely as a function of the terminal width. This driver
// walks the widths that straddle both thresholds and records what the pane ACTUALLY carried.
//
// ISOLATION (dsh-qa hard rule 1): the sandbox root is an explicit `--sandbox-root`; the lane never
// defaults into the repository's own `.mpd` state, and no boot reads or writes the real `~/.dsh`.
//
// Usage:
//   bun evidence/tui/dag-port/verification/pty/width-panel-capture.ts --sandbox-root <root> --widths 200,120,104,80
//   bun evidence/tui/dag-port/verification/pty/width-panel-capture.ts --self-test
// Output -> <outDir>/w<cols>/{boot.pane.txt,panel.pane.txt,result.json} + <outDir>/summary.json
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { parseSandboxArgs, runTuiSession } from "../../../../../skills/dsh-qa/scripts/lib/tui-lane.ts"

/** Where this driver's captures land, relative to the sandbox root's sibling evidence tree. */
const OUT_ROOT = join(import.meta.dir, "run")

/** The host's own "this panel is narrower than its declared floor" string, in both languages it renders. */
const TOO_NARROW: RegExp = /宽度不足|Too narrow \(needs/

/** The keyed MPD status line; its presence proves the TUI painted a real chat screen, not a splash. */
const STATUS_LINE: RegExp = /mpd:\s+(?:team|团队)/

/** How one width's capture was classified, from the pane text alone. */
export interface WidthVerdict {
  /** The tmux pane width in columns that was requested. */
  readonly cols: number
  /** True when the boot pane carried the keyed MPD status line (the chat screen really rendered). */
  readonly chatRendered: boolean
  /** True when any frame carried the host's too-narrow notice for a panel. */
  readonly tooNarrow: boolean
  /** True when any frame carried a sidebar split (a vertical divider with content to its right). */
  readonly splitPresent: boolean
  /** True when the MPD panel title appears in any frame (the panel was reachable and painted). */
  readonly panelTitleSeen: boolean
  /** The pane's own longest line, in terminal cells, so a reader can see the width really applied. */
  readonly widestLine: number
  /** Every distinct tab strip the host painted in this width's frames, so the reach claim is legible. */
  readonly panelBars: readonly string[]
  /** True when one of those strips names the MPD/team tab, i.e. the panel reached the sidebar at all. */
  readonly mpdTabSeen: boolean
  /** Where the two captures were written, relative to the sandbox root. */
  readonly bootPane: string
  /** The pane captured after `/mpd panel` was submitted. */
  readonly panelPane: string
  /** Lifecycle failures the harness reported for this width, verbatim. */
  readonly failures: readonly string[]
}

/**
 * The split sidebar's own anatomy, read out of a captured pane.
 *
 * The divider column is found as the column carrying a vertical rule on the most rows, then the
 * RIGHT of that column is the sidebar: its first non-blank row is the host's `PanelBar` tab strip,
 * and the rest is the active panel's body.
 */
interface SidebarAnatomy {
  /** The pane column the sidebar's divider sits at, `-1` when no split is present. */
  readonly divider: number
  /** The tab strip's own text, trimmed; empty when no split or no bar row. */
  readonly bar: string
  /** How many rows right of the divider carry any non-blank content, body rows EXCLUDED. */
  readonly bodyRows: number
}

/**
 * Count the terminal cells in one pane line, CJK-aware.
 *
 * A naive `length` would report a 40-character CJK row as 40 cells when a terminal draws 80, which is
 * exactly the shear this capture exists to expose, so the width is measured the way a terminal does.
 * @param line - one line of pane text, already ANSI-free.
 * @returns the line's display width in cells.
 */
function cells(line: string): number {
  let total = 0
  for (const char of line) {
    const cp = char.codePointAt(0) ?? 0
    if (cp < 0x20 || cp === 0x7f) continue
    const wide = (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf)
      || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
      || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60)
      || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f9ff)
    total += wide ? 2 : 1
  }
  return total
}

/**
 * Read one pane's sidebar anatomy.
 * @param pane - the captured pane text.
 * @returns the divider column, the tab strip and the body's fill count.
 */
function sidebarAnatomy(pane: string): SidebarAnatomy {
  /** How many rows carry a vertical rule at each pane column. */
  const tally = new Map<number, number>()
  for (const line of pane.split("\n")) {
    const chars = [...line]
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === "│" || chars[i] === "┃" || chars[i] === "║") tally.set(i, (tally.get(i) ?? 0) + 1)
    }
  }
  /** The column with the most rows of vertical rule; `-1` when there is none at all. */
  let divider = -1
  for (const [column, count] of tally) if (count >= 3 && count > (tally.get(divider) ?? 0)) divider = column
  if (divider < 0) return { divider: -1, bar: "", bodyRows: 0 }
  /** The sidebar's own text, one entry per pane row. */
  const right = pane.split("\n").map(line => [...line].slice(divider + 1).join(""))
  // The FRAME's own rules sit at the same divider column as the tabs, so "the first non-blank row"
  // would read the top border as the tab strip. A rule-only row is therefore skipped, and the tab
  // strip is the first row that carries something other than border glyphs.
  /** Index of the first sidebar row carrying more than border glyphs, which is the tab strip. */
  const barAt = right.findIndex(text => text.trim() !== "" && !/^[\s─━═┄┅┈┉┊┋┌┐└┘├┤┬┴┼╭╮╰╯│┃║]+$/u.test(text))
  if (barAt < 0) return { divider, bar: "", bodyRows: 0 }
  // The sidebar is framed: the strip, a rule, the BODY, a rule, then the host's footer hint. The
  // body is therefore the rows between the FIRST and the LAST rule-only row — which is also what
  // keeps the host's footer (`Esc 聊天 · ←/→ 切换`) from being counted as panel content.
  /** The sidebar rows below the strip. */
  const afterBar = right.slice(barAt + 1)
  /** Indices of the rule-only rows below the strip. */
  const rules = afterBar.map((text, index) => ({ text, index }))
    .filter(entry => entry.text.trim() !== "" && /^[\s─━═┄┅┈┉┊┋┌┐└┘├┤┬┴┼╭╮╰╯│┃║]+$/u.test(entry.text))
    .map(entry => entry.index)
  const body = rules.length >= 2
    ? afterBar.slice(rules[0] + 1, rules[rules.length - 1])
    : rules.length === 1 ? afterBar.slice(rules[0] + 1) : afterBar
  return { divider, bar: right[barAt].trim(), bodyRows: body.filter(text => text.trim() !== "").length }
}

/**
 * Classify one width's captures.
 * @param cols - the requested pane width.
 * @param bootPane - the pane captured after the chat screen settled.
 * @param panelPane - the pane captured after `/mpd panel` was submitted.
 * @param sidebarPane - the pane captured after `C-b` split the layout.
 * @param tabPanes - the panes captured after each `Right` press, in order.
 * @param bootPath - evidence path of the boot capture.
 * @param panelPath - evidence path of the panel capture.
 * @param failures - lifecycle failures the harness reported.
 * @returns the verdict, ready to serialise.
 */
function classifyWidth(
  cols: number,
  bootPane: string,
  panelPane: string,
  sidebarPane: string,
  tabPanes: readonly string[],
  bootPath: string,
  panelPath: string,
  failures: readonly string[],
): WidthVerdict {
  /** Every frame this width produced, in drive order — the reach assertion reads all of them. */
  const frames = [panelPane, sidebarPane, ...tabPanes]
  /** The sidebar anatomy of every frame, so a tab that only appears in one is still seen. */
  const bars = frames.map(frame => sidebarAnatomy(frame).bar).filter(bar => bar !== "")
  const lines = panelPane.split("\n")
  return {
    cols,
    chatRendered: STATUS_LINE.test(bootPane),
    tooNarrow: frames.some(frame => TOO_NARROW.test(frame)),
    splitPresent: frames.some(frame => sidebarAnatomy(frame).divider >= 0),
    panelTitleSeen: /MPD/.test(frames.join("\n")),
    widestLine: lines.reduce((max, line) => Math.max(max, cells(line)), 0),
    panelBars: [...new Set(bars)],
    mpdTabSeen: bars.some(bar => /MPD|team/i.test(bar)),
    bootPane: bootPath,
    panelPane: panelPath,
    failures,
  }
}

/**
 * Capture one width: boot the real TUI, then walk the panel's own entry points and capture each.
 *
 * THE STEP LIST IS A MEASURED FINDING, not a preference. `/mpd panel` alone never splits the pane
 * (see the report): the host's `TuiPanelRuntime.open` answers `true` because the bridge CONSUMED the
 * request, while `useSidePanel.openPanel` returns early unless the id is already in the enabled
 * panel CSV — so the plugin prints "opened" and the layout never changes. `C-b` is the host's own
 * smart toggle and DOES split, so the sidebar is captured through it, and the `Right` steps walk
 * every registered tab so a panel that is present-but-not-active is still visible in some frame.
 * @param root - absolute sandbox root (its `ws/` becomes the session workspace).
 * @param cols - the tmux pane width in columns.
 * @param outRoot - directory the per-width capture folders are created under.
 * @returns the width's verdict.
 */
function captureWidth(root: string, cols: number, outRoot: string, sidebarOpenAtBoot: boolean): WidthVerdict {
  const outDir = join(outRoot, `w${cols}`)
  mkdirSync(outDir, { recursive: true })
  // `--mode pin` captures R11's detail body through the page's OWN documented keys (`Enter pin`),
  // reached deterministically: with the sidebar open the active page is `MPD`, so ONE `Right` is the
  // `MPD DAG` page, and the two `Down`s pick a task before `Enter`. A guessed navigation is how the
  // first attempt captured the workmate body and called it a pin.
  const pinMode = process.argv.includes("--mode") && process.argv[process.argv.indexOf("--mode") + 1] === "pin"
  const session = runTuiSession({
    lane: `fidelity-w${cols}${pinMode ? "-pin" : ""}`,
    root,
    outDir,
    paneWidth: cols,
    paneHeight: 50,
    steps: pinMode
      ? [
        // `/mpd panel` first: it FOCUSES our page, which is what makes the next `Right` deterministic.
        // MEASURED: without it the boot's active page is the CSV's first entry (`todo`), so the `Right`
        // steps walked the wrong strip and the capture came back as the todo page.
        { name: "panel", keys: ["/mpd panel", "Enter"], waitMs: 8000 },
        { name: "dag", keys: ["Right"], waitMs: 5000 },
        { name: "pin", keys: ["Down", "Down", "Enter"], waitMs: 6000 },
      ]
      : sidebarOpenAtBoot
      // A CONFIGURED-OPEN sidebar is already split at boot, so `C-b` would CLOSE it. The step list is
      // therefore a property of the sandbox's own config, not a constant: with `sidePanel.open: true`
      // the boot frame is the sidebar frame, and the walk starts straight at the tab strip.
      ? [
        { name: "panel", keys: ["/mpd panel", "Enter"], waitMs: 8000 },
        { name: "tab1", keys: ["Right"], waitMs: 4000 },
        { name: "tab2", keys: ["Right"], waitMs: 4000 },
        { name: "tab3", keys: ["Right"], waitMs: 4000 },
        { name: "tab4", keys: ["Right"], waitMs: 4000 },
        { name: "tab5", keys: ["Right"], waitMs: 4000 },
        // BACK TO THE DAG PAGE AND PIN A TASK. The walk above ends on the host's last builtin
        // (`代理`), and the DAG page sits one step right of `MPD`, so four Lefts return to it. The
        // `Down`/`Enter` pair is R11's detail body: the page's own key contract is
        // `↑↓/jk move · Enter pin · Esc unpin`, so this is the documented path, not a guess.
        { name: "back", keys: ["Left", "Left", "Left", "Left"], waitMs: 4000 },
        { name: "pin", keys: ["Down", "Down", "Enter"], waitMs: 5000 },
      ]
      : [
        { name: "panel", keys: ["/mpd panel", "Enter"], waitMs: 8000 },
        { name: "sidebar", keys: ["C-b"], waitMs: 6000 },
        { name: "tab1", keys: ["Right"], waitMs: 4000 },
        { name: "tab2", keys: ["Right"], waitMs: 4000 },
        { name: "tab3", keys: ["Right"], waitMs: 4000 },
      ],
  })
  const bootPath = join(outDir, "boot.pane.txt")
  writeFileSync(bootPath, session.panes[0]?.text ?? session.bootPane ?? "")
  const panelPath = join(outDir, "panel.pane.txt")
  const panel = session.panes.find(entry => entry.name === "panel")
  writeFileSync(panelPath, panel?.text ?? "")
  /** The sidebar frame: the boot capture when the sandbox config opened it, else the `C-b` capture. */
  const sidebar = sidebarOpenAtBoot ? session.panes[0] : session.panes.find(entry => entry.name === "sidebar")
  /** Every tab frame, so the reach assertion reads the same captures the report cites. */
  const tabFrames = session.panes.filter(entry => entry.name.startsWith("tab"))
  return classifyWidth(cols, session.bootPane ?? "", panel?.text ?? "", sidebar?.text ?? "",
    tabFrames.map(entry => entry.text), bootPath, panelPath, session.failures ?? [])
}

/** The widths driven when the caller names none: the two thresholds and the widths around them. */
const DEFAULT_WIDTHS = "200,120,105,104,96,80,48,32"

/**
 * Parse the width matrix out of a raw argv slice.
 *
 * Kept pure and separate from `main` so the one failure mode that already bit this driver — a
 * parser that silently yielded an EMPTY list, which `[].every(...)` then reported as a green PASS —
 * is asserted by the self-test rather than remembered. Both the `--widths v` and `--widths=v`
 * spellings are honoured, because the repo's own harness parsers accept both.
 * @param argv - the process argv slice, without the node/bun prefix.
 * @returns the widths in drive order; EMPTY when nothing parsable was named (the caller must refuse).
 */
function parseWidths(argv: readonly string[]): number[] {
  const at = argv.findIndex(arg => arg === "--widths" || arg.startsWith("--widths="))
  const raw = at < 0
    ? DEFAULT_WIDTHS
    : argv[at].includes("=") ? argv[at].slice(argv[at].indexOf("=") + 1) : (argv[at + 1] ?? "")
  return raw.split(",").map(token => Number(token.trim())).filter(value => Number.isInteger(value) && value > 0)
}

/**
 * The offline control: the same classifier, run against fixtures whose answers are known.
 *
 * Without this arm a green matrix would only prove the driver ran. The negative fixture is the
 * important one — it makes `tooNarrow` and `splitPresent` falsifiable rather than decorative.
 * @returns nothing; throws when an arm disagrees with its fixture.
 */
function selfTest(): void {
  // The fixtures are PANE-SHAPED: the chat column is padded to the divider, exactly as tmux pads
  // it, so the reader is exercised against the real geometry rather than a convenient one.
  const pad = (left: string, to: number): string => left + " ".repeat(Math.max(0, to - cells(left)))
  /** A pane carrying every positive signal at once: a split, a tab strip naming MPD, and a body. */
  const good = [
    pad("mpd: t", 12) + "│ ",
    pad("", 12) + "│ ‹ MPD › ≡",
    pad("", 12) + "│ ───────────",
    pad("", 12) + "│ ✓ T1 WRK 冻结验收契约",
    pad("", 12) + "│ ◆ T2 WRK 自适应纵向布局",
    pad("", 12) + "│ ───────────",
    pad("❯ ", 12) + "│ Esc 聊天 · ←/→ 切换",
  ].join("\n")
  const goodVerdict = classifyWidth(200, "mpd: team x", good, good, [good], "b", "p", [])
  if (!goodVerdict.chatRendered || !goodVerdict.splitPresent || !goodVerdict.panelTitleSeen || goodVerdict.tooNarrow) {
    throw new Error("self-test: the positive fixture was not classified as a rendered panel")
  }
  if (!goodVerdict.mpdTabSeen || goodVerdict.panelBars.length !== 1) {
    throw new Error("self-test: the tab strip was not read out of the split fixture")
  }
  /** A pane carrying the host's too-narrow notice instead of a panel body. */
  const narrow = [
    pad("mpd: team x", 12) + "│ ",
    pad("", 12) + "│ ‹ MPD ›",
    pad("", 12) + "│ 宽度不足（需 ≥ 32 列）",
    pad("❯ ", 12) + "│ ",
  ].join("\n")
  const narrowVerdict = classifyWidth(100, "mpd: team x", narrow, narrow, [], "b", "p", [])
  if (!narrowVerdict.tooNarrow) throw new Error("self-test: the too-narrow fixture was not detected")
  /** A pane with no sidebar at all: the chat fills the width. */
  const flat = ["mpd: team x", "hello", "❯ "].join("\n")
  const flatVerdict = classifyWidth(80, "mpd: team x", flat, flat, [], "b", "p", [])
  if (flatVerdict.splitPresent || flatVerdict.tooNarrow || flatVerdict.mpdTabSeen) {
    throw new Error("self-test: the flat fixture was misread as a split, a too-narrow notice or a reachable tab")
  }
  /** The bar reader must skip the frame's own rules and decode the host's strip grammar. */
  const anatomy = sidebarAnatomy([
    pad("x", 12) + "│──────────",
    pad("x", 12) + "│ ‹ 待办 › ▸ ◆",
    pad("x", 12) + "│──────────",
    pad("x", 12) + "│ body row",
    pad("x", 12) + "│──────────",
  ].join("\n"))
  if (anatomy.divider < 0 || anatomy.bar !== "‹ 待办 › ▸ ◆" || anatomy.bodyRows !== 1) {
    throw new Error("self-test: the sidebar anatomy reader did not decode the strip and the body")
  }
  /** The cell counter must treat a CJK row as twice its character count. */
  if (cells("冻结") !== 4 || cells("ab") !== 2) throw new Error("self-test: the cell counter is not CJK-aware")
  /** The width parser: both spellings, the default, and the empty case the caller must refuse. */
  if (parseWidths(["--widths", "200,120"]).join() !== "200,120") throw new Error("self-test: the space-separated widths spelling is not parsed")
  if (parseWidths(["--widths=48,32"]).join() !== "48,32") throw new Error("self-test: the `=` widths spelling is not parsed")
  if (parseWidths([]).length !== DEFAULT_WIDTHS.split(",").length) throw new Error("self-test: the default width matrix is not applied")
  if (parseWidths(["--widths", ""]).length !== 0) throw new Error("self-test: an empty width list must parse to empty so the caller can refuse it")
  console.log("self-test PASS (10 arms: positive, tab-strip, too-narrow, flat, anatomy, CJK cell width, 4 width-parser arms)")
}

/**
 * Drive the width matrix and write its summary.
 * @returns the process exit code: 0 when the chat screen rendered at every width, 1 otherwise.
 */
function main(): number {
  const argv = process.argv.slice(2)
  if (argv.includes("--self-test")) {
    selfTest()
    return 0
  }
  const { root } = parseSandboxArgs(argv, "fidelity-width")
  if (!existsSync(join(root, "dshhome"))) {
    console.error(`[fidelity] no provisioned profile at ${root} — run tui-mount --install into that root first`)
    return 1
  }
  // `--widths` takes its value as the NEXT argv entry, or an `=`-joined one; see `parseWidths`.
  const widths = parseWidths(argv)
  if (widths.length === 0) {
    console.error(`[fidelity] FATAL: no width was parsed out of ${JSON.stringify(argv)} — refusing to run a vacuous matrix`)
    return 1
  }
  // `--sidebar open` declares a sandbox whose config already splits the layout, which changes whether
  // the driver must press the toggle; see `captureWidth`.
  /** True when the sandbox's own config opens the sidebar, so no `C-b` press is needed. */
  const sidebarOpenAtBoot = argv.includes("--sidebar") && argv[argv.indexOf("--sidebar") + 1] === "open"
  const outRoot = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : OUT_ROOT
  mkdirSync(outRoot, { recursive: true })
  /** One verdict per requested width, in drive order. */
  const verdicts: WidthVerdict[] = []
  for (const cols of widths) {
    console.log(`[fidelity] capturing ${cols} cols …`)
    const verdict = captureWidth(root, cols, outRoot, sidebarOpenAtBoot)
    verdicts.push(verdict)
    console.log(`[fidelity]   chat=${verdict.chatRendered} split=${verdict.splitPresent} tooNarrow=${verdict.tooNarrow} widest=${verdict.widestLine} bars=${JSON.stringify(verdict.panelBars)} mpdTab=${verdict.mpdTabSeen}`)
  }
  writeFileSync(join(outRoot, "summary.json"), JSON.stringify({ root, widths, verdicts }, null, 2) + "\n")
  // `captured` is checked FIRST: `[].every(...)` is true, so a matrix that captured nothing would
  // otherwise report the same PASS as a matrix that captured every width cleanly.
  const captured = verdicts.length === widths.length && verdicts.length > 0
  const allBooted = captured && verdicts.every(verdict => verdict.chatRendered)
  console.log(`[fidelity] captured ${verdicts.length}/${widths.length} widths`)
  console.log(allBooted ? "[fidelity] PASS: every width booted the chat screen" : "[fidelity] FAIL: a width never painted the chat screen")
  return allBooted ? 0 : 1
}

process.exit(main())
