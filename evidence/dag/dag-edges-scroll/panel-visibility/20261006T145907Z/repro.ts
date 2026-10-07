#!/usr/bin/env bun
// STEP 1 / STEP 4 reproduction driver — the sidebar panel-visibility defect.
//
// WHAT IT MEASURES. Three readings of ONE boot, so the outcome and the transition can be compared:
//   (a) the PANE's tab strip, captured before and after `C-b` splits the sidebar (the derived
//       surface: the host's `PanelBar` renders exactly `parseSidePanelIds(getSidePanelPanels())`
//       intersected with what actually registered);
//   (b) the LIVE enable list — the host's own `getSidePanelPanels()` CSV, recorded on EVERY change
//       plus a 250 ms poll by `probe/panel-prefs-probe.mjs`, injected with `NODE_OPTIONS=--import`
//       into the host's own process;
//   (c) the host's OWN panel registry (`components/sidePanel/PanelStore.js`), which names the id
//       the host composed for every registration.
//
// ISOLATION (dsh-qa hard rule 1, three ways): the sandbox root is an explicit `--sandbox-root` whose
// `dshhome` is `DSH_HOME`, whose `home` is `HOME`, and whose `ws` is the session workspace (both the
// `DSH_TUI_WORKSPACE_TARGET` env key and the tmux pane's cwd) — so no boot here reads or writes the
// real `~/.dsh`, `~/.dsh-tui` or the repository's own `.mpd` state.
//
// Usage:
//   bun <this file> --sandbox-root <dir> --out <dir> --label <name> --panels <csv|none>
// Output -> <out>/{result.json,output.log,captures/*.pane.txt}
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"

import { runTuiSession, sleepMs } from "../../../../../skills/dsh-qa/scripts/lib/tui-lane.ts"
import type { TuiStep } from "../../../../../skills/dsh-qa/scripts/lib/tui-lane.ts"

/** The probe module injected into the host process (built with `--import` below). */
const PROBE = fileURLToPath(new URL("./probe/panel-prefs-probe.mjs", import.meta.url))

/** The pane geometry: wide enough that the sidebar split and every tab label paint unwrapped. */
const PANE_WIDTH = 220
/** The pane height used by every capture in this file. */
const PANE_HEIGHT = 50

/** One named string read out of the command line. */
function arg(name: string): string | undefined {
  /** Index of the flag; `-1` when the caller did not pass it. */
  const at = process.argv.indexOf("--" + name)
  return at < 0 ? undefined : process.argv[at + 1]
}

/** How many rows carry a vertical rule at each pane column, and the sidebar that follows it. */
interface SidebarAnatomy {
  /** The pane column the sidebar's divider sits at, `-1` when no split is present. */
  divider: number
  /** The tab strip's own text, trimmed; empty when no split or no bar row. */
  bar: string
}

/**
 * Read one pane's sidebar anatomy.
 *
 * Copied in shape from the reviewer's driver
 * (`evidence/tui/dag-port/verification/pty/width-panel-capture.ts`) rather than imported, because
 * that file exports no symbol and is frozen evidence; the rule it implements is the same one: the
 * divider is the column carrying a vertical rule on the most rows, and the sidebar's own TAB STRIP
 * is the first row right of it that carries more than border glyphs.
 * @param pane - the captured pane text.
 * @returns the divider column and the tab strip.
 */
function sidebarAnatomy(pane: string): SidebarAnatomy {
  /** How many rows carry a vertical rule at each pane column. */
  const tally = new Map<number, number>()
  for (const line of pane.split("\n")) {
    /** The line as code points, so a CJK glyph counts as one column of the pane. */
    const chars = [...line]
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === "│" || chars[i] === "┃" || chars[i] === "║") tally.set(i, (tally.get(i) ?? 0) + 1)
    }
  }
  /** The column with the most rows of vertical rule; `-1` when there is none at all. */
  let divider = -1
  for (const [column, count] of tally) if (count >= 3 && count > (tally.get(divider) ?? 0)) divider = column
  if (divider < 0) return { divider: -1, bar: "" }
  /** The sidebar's own text, one entry per pane row. */
  const right = pane.split("\n").map(line => [...line].slice(divider + 1).join(""))
  /** The first sidebar row carrying anything other than border glyphs — the tab strip. */
  const barAt = right.findIndex(text => text.trim() !== "" && !/^[\s─━═┄┅┈┉┊┋┌┐└┘├┤┬┴┼╭╮╰╯│┃║]+$/u.test(text))
  return { divider, bar: barAt < 0 ? "" : right[barAt].trim() }
}

/**
 * Rewrite the sandbox profile's `dsh-tui` row so `sidePanel.panels` is either ABSENT (the schema
 * default applies — the user's stock case) or exactly `csv`.
 *
 * The rewrite is textual on purpose: the patch file is YAML with `!!js` tags, and a text edit keeps
 * every other line (provider, effort, preset, workspace) byte-identical, so the two arms differ in
 * exactly one key.
 * @param patchFile - absolute path of the sandbox profile's `cordis.patch.yml`.
 * @param csv - the CSV to force, or `undefined` to leave the key out entirely.
 * @returns the file content written.
 */
function writePanels(patchFile: string, csv: string | undefined): string {
  /** The patch as it stands before the edit. */
  const before = readFileSync(patchFile, "utf8")
  /** The patch with every `panels:` line removed, then the requested one appended to `sidePanel`. */
  const stripped = before.split("\n").filter(line => !/^\s*panels:/.test(line)).join("\n")
  /** The edited content: the key is inserted under the `sidePanel:` block when one was requested. */
  const after = csv === undefined
    ? stripped
    : stripped.replace(/^(\s*)sidePanel:\n/m, `$1sidePanel:\n$1  panels: "${csv}"\n`)
  writeFileSync(patchFile, after)
  return after
}

/** Everything one arm recorded, as it lands in `result.json`. */
interface ArmResult {
  /** The arm's label, from `--label`. */
  readonly label: string
  /** The absolute sandbox root this arm booted in. */
  readonly sandboxRoot: string
  /** The `dsh-tui` row config the boot actually ran with, read back from the profile patch. */
  readonly profilePatch: string
  /** True when a settings file existed anywhere in the sandbox home (must stay false for a stock arm). */
  readonly settingsFilePresent: boolean
  /** The tab strip read from the boot capture (`""` when no sidebar was painted). */
  readonly bootBar: string
  /** The tab strip read from the capture taken after `C-b` split the layout. */
  readonly sidebarBar: string
  /** The tab strip read from the LAST capture, taken after the keeper's whole ladder expired. */
  readonly settledBar: string
  /** Every distinct tab strip painted across the arm's frames, in drive order. */
  readonly bars: readonly string[]
  /** True when any frame's tab strip names an MPD tab (team / dag / workmate). */
  readonly mpdTabSeen: boolean
  /** The live enable CSV recorded by the in-process probe, change events only, in order. */
  readonly csvEvents: readonly string[]
  /** The live enable CSV recorded by the in-process probe's polls, in order. */
  readonly csvPolls: readonly string[]
  /** Every distinct enable CSV the probe ever observed. */
  readonly csvDistinct: readonly string[]
  /** Every distinct panel-registry snapshot the probe observed (`<id>@<source>` rows). */
  readonly regDistinct: readonly string[]
  /** The panel ids the host's own registry held, split out of those snapshots. */
  readonly registeredIds: readonly string[]
  /** The MPD-owned registered ids, i.e. the ones whose registration the CSV must carry. */
  readonly mpdRegisteredIds: readonly string[]
  /** True when every MPD-registered id was present in the LAST enable CSV the probe observed. */
  readonly mpdIdsSettledEnabled: boolean
  /** The adapter's OWN settle lines, which is how the fixed boot reports what the keeper did. */
  readonly keeperLines: readonly string[]
  /** The ids the adapter recorded for the remedy script, read back from its record file. */
  readonly recordedIds: readonly string[]
  /** The host process's pid among the probe's records; every series above is filtered to it. */
  readonly hostPid: string
  /** How many pids the probe armed in, so a reader can see how many foreign stores were ignored. */
  readonly probePids: readonly string[]
  /** Lifecycle failures the harness reported; empty is a clean run. */
  readonly failures: readonly string[]
}

/** The parsed command line of one arm. */
const sandboxRoot = resolve(arg("sandbox-root") ?? "")
const outDir = resolve(arg("out") ?? "")
const label = arg("label") ?? "arm"
const panels = arg("panels")
if (!existsSync(sandboxRoot) || outDir === "") {
  console.error("usage: --sandbox-root <dir> --out <dir> --label <name> --panels <csv|none>")
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

/** The sandbox profile directory the boot resolves its rows from. */
const profileDir = join(sandboxRoot, "dshhome", "profiles", "dsh-tui")
/** The profile's own patch layer — the ONE key this driver edits between arms. */
const patchFile = join(profileDir, "cordis.patch.yml")
/** The host package root inside the profile; every probe path is relative to it. */
const hostRoot = join(profileDir, "node_modules", "@deepseek-harness-tui", "dsh-tui")
/** The host module owning the live panel CSV. */
const prefsUrl = pathToFileURL(join(hostRoot, "lib", "types", "tuiDisplayPrefs.js")).href
/** The host's own panel registry. */
const storeUrl = pathToFileURL(join(hostRoot, "lib", "types", "components", "sidePanel", "PanelStore.js")).href
/** The probe's append-only log, inside this arm's output directory. */
const probeLog = join(outDir, "panel-prefs-probe.log")
writeFileSync(probeLog, "")

/** The profile patch as this arm configured it, recorded verbatim in the result. */
const patchText = panels === "keep"
  // `keep` leaves the document EXACTLY as the run found it, which is what the STEP 3 arm needs: the
  // remedy script is what must have written the enable list, so the driver must not also write it.
  ? readFileSync(patchFile, "utf8")
  : writePanels(patchFile, panels === "none" ? undefined : panels)

/** The env prefix that arms the probe inside the host process; quoted for the pane's own shell. */
const probePrefix = `MPD_PANEL_PROBE_LOG='${probeLog}' MPD_PANEL_PROBE_PREFS='${prefsUrl}' MPD_PANEL_PROBE_STORE='${storeUrl}' NODE_OPTIONS='--import ${pathToFileURL(PROBE).href}'`

/** The keystrokes driven after the boot: split the sidebar, then walk every tab it offers. */
const steps: TuiStep[] = [
  { name: "sidebar", keys: ["C-b"], waitMs: 4000 },
  { name: "tab-right-1", keys: ["Right"], waitMs: 2500 },
  { name: "tab-right-2", keys: ["Right"], waitMs: 2500 },
  { name: "tab-right-3", keys: ["Right"], waitMs: 2500 },
  // The keeper's settle ladder ends at +25 s from the first registration, so an arm that judges the
  // FIXED revision must stay alive past that instant: a capture taken earlier would judge a window in
  // which the ladder is still legitimately working, and would report a loss the ladder then repairs.
  { name: "settled", keys: [], waitMs: 30000 },
]

/** An extra `K=V` assignment prepended to the boot line, for a control arm that needs one. */
const bootEnv = arg("boot-env")

// The adapter's sink APPENDS and its id record is overwritten in place, so an arm that reuses a
// sandbox would otherwise read a previous boot's lines. Both are reset to empty before this boot, so
// every reading below belongs to ONE lifecycle — which is the whole point of a before/after capture.
writeFileSync(join(sandboxRoot, "ws", ".mpd", "logs", "mpd-tui.log"), "")
writeFileSync(join(sandboxRoot, "ws", ".mpd", "logs", "mpd-tui-panels.json"), "")

console.log(`[panel-visibility] arm=${label} sandbox=${sandboxRoot}`)
console.log(`[panel-visibility] sidePanel.panels=${panels ?? "<none>"}`)
/** The full PTY lifecycle; one process owns spawn, drive, capture and kill. */
const session = runTuiSession({
  // The lane slug names the private tmux socket, whose path must stay under the ~107-character
  // `sun_path` limit. MEASURED: at the full evidence path the socket name was refused outright
  // (`error connecting to …sock (File name too long)`), so the sandbox lives at a short scratch root
  // (`.mpd/recon/pv`, gitignored like every other QA sandbox) and the slug is kept to two segments.
  lane: "pv-" + label,
  root: sandboxRoot,
  outDir: join(outDir, "captures"),
  steps,
  bootWaitMs: 120_000,
  paneWidth: PANE_WIDTH,
  paneHeight: PANE_HEIGHT,
  bootCommand: (bootEnv === undefined ? "" : `${bootEnv} `) + probePrefix + " dsh-tui",
})
// The probe writes on its own timer; give it one more interval after the pane work settled, so the
// settle ladder a fix runs is fully inside the recorded window.
sleepMs(3000)

/** The probe's raw log, split into records for the classification below. */
const probeRaw = readFileSync(probeLog, "utf8")
/** The probe lines, one record each, kept verbatim for the evidence. */
const probeLines = probeRaw.split("\n").filter(line => line !== "")
writeFileSync(join(outDir, "panel-prefs-probe.log"), probeRaw)

// ── WHICH PROCESS'S READINGS COUNT ─────────────────────────────────────────────────────────────
//
// `NODE_OPTIONS=--import` arms the probe in EVERY node process the boot spawns, and each one loads
// its OWN copy of the host's `tuiDisplayPrefs.js` — a copy with its own module-level store that never
// changes. MEASURED (this driver's first run): 1223 poll lines, most of them `todo,jobs,agents` from
// MCP children, so "the last poll" was a FOREIGN process's empty store and `settledEnabled` read
// false on an arm whose sidebar plainly painted the MPD tab. The host is the process that OBSERVED a
// change, so its pid is derived from the `CHANGE` records and every series below is filtered to it.
/** The pids that logged at least one `CHANGE`; the first is the host process. */
const changePids = [...new Set(probeLines.filter(line => line.includes(" CHANGE ")).map(line => / pid=(\d+) /u.exec(line)?.[1] ?? "").filter(pid => pid !== ""))]
/** The host process's pid, `""` when no change was ever observed. */
const hostPid = changePids[0] ?? ""
/** True when one probe line belongs to the host process that observed the changes. */
const fromHost = (line: string): boolean => hostPid === "" || line.includes(` pid=${hostPid} `)

/** Every `CHANGE` payload, in order — one per actual write to the live CSV. */
const csvEvents = probeLines.filter(line => line.includes(" CHANGE ")).map(line => line.split(" CHANGE ")[1] ?? "")
/** Every `poll` payload of the HOST process, in order. */
const csvPolls = probeLines.filter(line => fromHost(line) && line.includes(" CSV poll ")).map(line => line.split(" CSV poll ")[1] ?? "")
/** Every `REG poll`/`REG initial` payload of the HOST process, in order. */
const regRows = probeLines.filter(line => fromHost(line) && / REG (poll|initial) /.test(line)).map(line => line.split(/ REG (?:poll|initial) /)[1] ?? "")

/**
 * The distinct values of one series, in first-seen order.
 * @param values - the series.
 * @returns its distinct members.
 */
function distinct(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/** Every panel id the host's registry ever carried, across all snapshots. */
const registeredIds = distinct(regRows.flatMap(row => row.split(",").map(cell => cell.split("@")[0] ?? "")).filter(id => id !== ""))
/** The MPD-owned registered ids: the `<pluginId>:<slug>` ids this bundle registered. */
const mpdRegisteredIds = registeredIds.filter(id => /:(team|dag|workmate)$/.test(id))
/** The last enable CSV the probe observed, `""` when it never saw one. */
const lastCsv = csvPolls[csvPolls.length - 1] ?? csvEvents[csvEvents.length - 1] ?? ""
/** The last enable CSV as a list. */
const lastCsvIds = lastCsv.split(",").map(entry => entry.trim()).filter(entry => entry !== "")
/** Every frame this arm captured, in drive order. */
const frames = session.panes.map(pane => pane.text)
/** Every distinct tab strip painted across those frames. */
const bars = distinct(frames.map(frame => sidebarAnatomy(frame).bar).filter(bar => bar !== ""))
/** The workspace the boot ran in: the pane's own cwd, which is where the adapter's sink resolves. */
const workspace = join(sandboxRoot, "ws")
/** The adapter's diagnostic sink, which carries the enable keeper's ONE settle line. */
const adapterLog = join(workspace, ".mpd", "logs", "mpd-tui.log")
/** The adapter's panel-id record, the file the remedy script reads. */
const idRecord = join(workspace, ".mpd", "logs", "mpd-tui-panels.json")
/** The adapter log's text, `""` when the boot never wrote one. */
const adapterLogText = existsSync(adapterLog) ? readFileSync(adapterLog, "utf8") : ""
/** The keeper's settle line(s), which is how the FIX reports what it did. */
const keeperLines = adapterLogText.split("\n").filter(line => line.includes("panel enable keeper"))
/** The ids the adapter recorded, as the remedy script would read them. */
let recordedIds: string[] = []
try {
  /** The parsed record; `panelIds` is narrowed rather than trusted. */
  const parsed = JSON.parse(readFileSync(idRecord, "utf8")) as { panelIds?: unknown }
  recordedIds = Array.isArray(parsed.panelIds) ? parsed.panelIds.filter((id): id is string => typeof id === "string") : []
} catch {
  recordedIds = []
}

/** The verdict this arm records. */
const result: ArmResult = {
  label,
  sandboxRoot,
  profilePatch: patchText,
  settingsFilePresent: ["settings.yaml", "settings.yml"].some(name =>
    [join(sandboxRoot, "dshhome", name), join(sandboxRoot, "home", ".dsh", name), join(sandboxRoot, "home", ".dsh-tui", name)].some(existsSync)),
  bootBar: sidebarAnatomy(session.bootPane).bar,
  sidebarBar: sidebarAnatomy(session.panes[1]?.text ?? "").bar,
  settledBar: sidebarAnatomy(session.panes.at(-1)?.text ?? "").bar,
  bars,
  // The panel's TITLE is what the host paints on the tab (`MPD`), not its id or slug: the ids are
  // `act1:team` on every measured boot, so a matcher keyed on the slug would miss the very tab this
  // arm exists to prove. Both spellings are accepted, so a host that paints either is seen.
  mpdTabSeen: bars.some(bar => /team|dag|workmate|MPD/i.test(bar)),
  csvEvents,
  csvPolls,
  csvDistinct: distinct([...csvEvents, ...csvPolls]),
  regDistinct: distinct(regRows),
  registeredIds,
  mpdRegisteredIds,
  mpdIdsSettledEnabled: mpdRegisteredIds.length > 0 && mpdRegisteredIds.every(id => lastCsvIds.includes(id)),
  keeperLines,
  recordedIds,
  hostPid,
  probePids: distinct(probeLines.map(line => / pid=(\d+) /u.exec(line)?.[1] ?? "").filter(pid => pid !== "")),
  failures: session.failures,
}

writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
writeFileSync(join(outDir, "output.log"), [
  `arm=${label}`,
  `sandbox=${sandboxRoot}`,
  `panels=${panels ?? "<none>"}`,
  `bootBar=${JSON.stringify(result.bootBar)}`,
  `sidebarBar=${JSON.stringify(result.sidebarBar)}`,
  `settledBar=${JSON.stringify(result.settledBar)}`,
  `bars=${JSON.stringify(bars)}`,
  `registeredIds=${JSON.stringify(registeredIds)}`,
  `mpdRegisteredIds=${JSON.stringify(mpdRegisteredIds)}`,
  `csvDistinct=${JSON.stringify(result.csvDistinct)}`,
  `csvEvents=${JSON.stringify(csvEvents)}`,
  `mpdIdsSettledEnabled=${String(result.mpdIdsSettledEnabled)}`,
  `keeperLines=${JSON.stringify(keeperLines)}`,
  `recordedIds=${JSON.stringify(recordedIds)}`,
  `hostPid=${hostPid} probePids=${JSON.stringify(result.probePids)}`,
  `failures=${JSON.stringify(session.failures)}`,
  "",
  "── probe log ──",
  probeRaw,
  "── adapter log (mpd-tui.log) ──",
  adapterLogText,
].join("\n") + "\n")
console.log(`[panel-visibility] bars=${JSON.stringify(bars)} registered=${JSON.stringify(registeredIds)} settledEnabled=${String(result.mpdIdsSettledEnabled)}`)
console.log(`[panel-visibility] keeper=${JSON.stringify(keeperLines)} recorded=${JSON.stringify(recordedIds)}`)
console.log(`[panel-visibility] -> ${outDir}`)
