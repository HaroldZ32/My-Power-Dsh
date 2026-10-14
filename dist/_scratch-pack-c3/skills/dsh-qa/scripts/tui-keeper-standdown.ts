#!/usr/bin/env bun
// Case tui-keeper-standdown: the C2 real-PTY arm of the tui-015-adaptation wave — prove, on the
// INSTALLED 0.15.0 host, that an explicit `/settings` removal of BOTH MPD sidebar panels STAYS
// removed: the 0.14-era enable-list keeper stands down on a self-healing host and never repairs.
//
// What it proves (always from a real pane the host painted, or a file the host itself wrote):
//   (a) BOTH plugin-panel rows exist and are CHECKED in the `/settings` panel picker before the
//       drive (the pre-state the removal needs — found by the host's own `插件面板（actN）` /
//       `Plugin panel (actN)` row descriptions, never by restating our panel ids);
//   (b) unticking BOTH rows via real keystrokes writes the user-layer `settings.json` CSV with
//       ZERO act-prefixed tokens (only this bundle's component id carries dots, so only OUR
//       panels ever take the host's `act<N>:` prefix);
//   (c) the removal STAYS: two more settings-apply hops (a builtin row toggled off and back on)
//       plus a 25 s poll of the user layer never re-adds an act-prefixed token — no keeper
//       repair, no host union-back of an explicitly removed id;
//   (d) NEGATIVE CONTROL MUST REDDEN: `act1:team` is written back into the user layer BY HAND
//       (exactly the write a repairing keeper would make) and the SAME detector must flip to
//       present — then the pruned value is restored and the detector must flip back.
//
// The interactive navigation is ADAPTIVE: the pane is captured between key presses, the focused
// row is located by its pointer glyph, and Up/Down presses are computed from the measured line
// distance — the host's focus-follow windowing never has to fit the pane.
//
// PREREQ: absent-dsh-binary dsh-tui "npm i -g @deepseek-harness-tui/dsh-tui@0.15.0"
// PREREQ: absent-runtime tmux "install tmux; the TUI requires a real TTY"
// PREREQ: absent-fixture tui profile in the sandbox root "bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root <root> --install"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-keeper-standdown.ts --self-test
//   bun skills/dsh-qa/scripts/tui-keeper-standdown.ts [--sandbox-root <dir>]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,*.pane.txt,tui-pane.log}
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  REPO, TUI_READY_PATTERN, artifactRevision, captureTuiPane, gateTuiPrereqs, laneEvidenceDir, laneSocket, makeChecks, manifestDigest, parseSandboxArgs,
  profileState, provisionTuiHome, runTuiSession, sandboxDataDir, sleepMs, tmux, tuiPrereqs, writeLaneEvidence, writeRevisionFile,
} from "./lib/tui-lane.ts"
import type { TuiStep } from "./lib/tui-lane.ts"

/** The case slug: names the evidence dir, the tmux socket and every marker/output line. */
const SLUG = "tui-keeper-standdown"
/** The token the negative control writes back: the 0.14-era keeper's own re-add spelling for the first-registered panel. */
const CONTROL_TOKEN = "act1:team"
/** The host's builtin panel ids the sandbox profile starts from (`DEFAULT_SIDE_PANEL_IDS`, unchanged in 0.15.0). */
const BUILTIN_PANEL_CSV = "todo,jobs,agents,info,trajectory,workspace,btw,companion"
/**
 * Our two registered panels' final ids in the host's enable CSV.
 *
 * The host builds each id as `<pluginId>:<panelId>` and falls back to `act<N>` only when the
 * component id fails its `pluginIdFor` regex — this bundle's dotted `com.mpd-dsh.mpd-tui` is the
 * only such registrant in the profile, so both of our panels (`team`, `workmate`) carry the SAME
 * `act1` prefix. Measured in the sandbox 0.15.0 pane: both rows render `插件面板（act1）`.
 */
const MPD_PANEL_IDS = ["act1:team", "act1:workmate"] as const
/** How many poll rounds the stay-removed observation runs (each 5 s apart). */
const SETTLE_ROUNDS = 5
/** Milliseconds between poll rounds. */
const SETTLE_INTERVAL_MS = 5_000

/** One settings row a captured pane exposes: its 0-based line index, its checkbox state and its raw line text. */
export interface SettingsRowMatch {
  /** 0-based line index of the row inside the captured pane text. */
  readonly line: number
  /** True when the row's checkbox renders checked (`[✓`), false when unchecked (`[  ]`). */
  readonly checked: boolean
  /** The row's whole rendered line, recorded verbatim for the evidence. */
  readonly text: string
}

/**
 * The tokens of a side-panel CSV the way the host normalizes them: split on commas, trimmed, lowercased, empties dropped.
 * @param csv The CSV string as the host's settings layer stores it.
 * @returns The normalized tokens, in stored order.
 */
export function csvTokens(csv: string): string[] {
  return csv.split(",").map((token) => token.trim().toLowerCase()).filter((token) => token !== "")
}

/**
 * The act-prefixed tokens of a token list — exactly this bundle's panel ids.
 *
 * The host prefixes a registered panel with `<pluginId>:`; only a component id the host's
 * `pluginIdFor` regex REJECTS falls back to `act<N>`, and this bundle's dotted
 * `com.mpd-dsh.mpd-tui` is the only such registrant in the profile — so an act-prefixed token
 * in the enable CSV is OUR panel, however the activation counter landed.
 * @param tokens The normalized CSV tokens.
 * @returns Every token matching `act<N>:…`.
 */
export function actPrefixedTokens(tokens: readonly string[]): string[] {
  return tokens.filter((token) => /^act\d+:/.test(token))
}

/**
 * Extract the side-panel panels CSV from the host's `settings.json` document.
 *
 * The host's own document shape (host `lib/types/tuiSettingsFile.js`) is
 * `{ version: 1, values: { sidePanel: { panels: "<csv>" } }, imported?: {...} }`. The reader reads
 * that `values` map FIRST, then falls back to a top-level `dsh-tui` nest and finally to any
 * `sidePanel.panels` anywhere in the tree, so both the live shape and an older one are understood.
 * @param text The settings.json bytes as read.
 * @returns The panels CSV string, or `undefined` when the document carries none.
 */
export function userLayerPanelsCsv(text: string): string | undefined {
  /** The decoded document; anything unreadable answers `undefined`, never a throw. */
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return undefined }
  /** Depth-first search for the first `sidePanel.panels` string in a subtree. */
  const search = (node: unknown): string | undefined => {
    if (node === null || typeof node !== "object") return undefined
    for (const [key, value] of Object.entries(node)) {
      if (key === "sidePanel" && value !== null && typeof value === "object") {
        /** The panels string inside one sidePanel object, when it is one. */
        const panels = (value as { panels?: unknown }).panels
        if (typeof panels === "string" && panels.trim() !== "") return panels
      }
      /** The nested hit, when the recursion below this key carries one. */
      const nested = search(value)
      if (nested !== undefined) return nested
    }
    return undefined
  }
  if (parsed !== null && typeof parsed === "object") {
    // 1) The HOST's own shape: the settings namespace's `values` map holds `sidePanel.panels`.
    /** The host document's user-layer values map, when it carries one. */
    const values = (parsed as { values?: unknown }).values
    if (values !== undefined) {
      /** The hit inside `values`. */
      const fromValues = search(values)
      if (fromValues !== undefined) return fromValues
    }
    // 2) The `dsh-tui` namespace is tried next so a sibling namespace carrying its own
    // `sidePanel.panels` can never shadow the one the host's save path writes.
    /** The document's top-level `dsh-tui` namespace, when it carries one. */
    const ns = (parsed as { "dsh-tui"?: unknown })["dsh-tui"]
    if (ns !== undefined) {
      /** The hit inside the `dsh-tui` nest. */
      const fromNs = search(ns)
      if (fromNs !== undefined) return fromNs
    }
  }
  return search(parsed)
}

/**
 * Write the user-layer panels CSV into the settings.json document, in the HOST's own shape.
 *
 * The write targets `{ version: 1, values: { sidePanel: { panels } } }` — the exact surface the
 * host's `writeTuiSettings` produces and `readTuiSettings` consumes (host `tuiSettingsFile.js`), so
 * BOTH the arm's pre-state seed and the negative control edit the file the host actually reads.
 * Every other key is preserved.
 * @param file The settings.json path.
 * @param csv The panels CSV to write as the user layer.
 */
export function writeUserLayerPanelsCsv(file: string, csv: string): void {
  /** The decoded document, or a fresh object when the file is absent or corrupt (siblings are never destroyed). */
  let doc: Record<string, unknown> = {}
  if (existsSync(file)) {
    try { doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown> } catch { doc = {} }
  }
  /** The user-layer values map, created when the document has none. */
  const values = typeof doc.values === "object" && doc.values !== null ? doc.values as Record<string, unknown> : {}
  /** The `sidePanel` object inside the values map, created when it has none. */
  const sidePanel = typeof values.sidePanel === "object" && values.sidePanel !== null ? values.sidePanel as Record<string, unknown> : {}
  sidePanel.panels = csv
  values.sidePanel = sidePanel
  doc.version = 1
  doc.values = values
  writeFileSync(file, JSON.stringify(doc, null, 2) + "\n")
}

/**
 * True for the host's `dsh-tui` page-mode group row that hides the side-panel picker.
 *
 * The `side-panel` setting group has `mode: 'page'`, so on the settings ROOT page its fields collapse
 * into one navigation row titled `侧栏` / `Side panel` whose right edge carries `›`; the
 * `sidePanel.panels` picker (and therefore every `插件面板（actN）` row) renders only on the
 * SUBPAGE this row opens (host `screens/Settings.js` `GroupRow` + `SETTING_GROUPS`).
 * @param line One captured pane line.
 * @returns True when the line is that group row.
 */
export function sidePanelGroupRow(line: string): boolean {
  return /(?:侧栏|Side panel)[^\n]*›/.test(line)
}

/**
 * Find the plugin-panel toggle rows in a captured `/settings` pane.
 *
 * A plugin panel's row carries the host's own description `插件面板（actN）` / `Plugin panel
 * (actN)` — the one marker that distinguishes a plugin-registered panel from every builtin row
 * without restating our ids, titles or icons.
 * @param paneText The captured settings pane.
 * @returns Every matching row, top to bottom, with its checkbox state.
 */
export function pluginPanelRows(paneText: string): SettingsRowMatch[] {
  /** The rows collected so far, in pane order. */
  const rows: SettingsRowMatch[] = []
  paneText.split("\n").forEach((line, index) => {
    if (/插件面板（act\d+）|Plugin panel \(act\d+\)/.test(line)) {
      rows.push({ line: index, checked: line.includes("[✓"), text: line.trim() })
    }
  })
  return rows
}

/**
 * The focused row's line index in a captured pane: the pointer glyph the settings screen renders
 * at the start of the focused row.
 * @param paneText The captured settings pane.
 * @returns The 0-based index of the focused line, or `undefined` when no pointer is on screen.
 */
export function focusedLine(paneText: string): number | undefined {
  /** The lines under inspection, with their indexes attached. */
  const lines = paneText.split("\n")
  for (let index = 0; index < lines.length; index++) {
    // The pointer glyph sits INSIDE the card's border (`  │ ❯ [✓] …`) and, on a subpage, inside the
    // group card too, so it is matched ANYWHERE on the line. Measured 2026-10-14 on the sandbox
    // 0.15.0 settings screen: the column-0 spelling found no row at all and the whole hunt ran blind.
    if (lines[index].includes("❯")) return index
  }
  return undefined
}

/** The tuning of one {@link focusAndActivate} hunt. */
export interface FocusHuntOptions {
  /** Maximum capture/press rounds before the hunt gives up. */
  readonly budget?: number
  /** How many Down presses one round sends while the target is still off-window. */
  readonly step?: number
  /** The label the hunt's progress lines carry, so a red run names WHICH hop failed. */
  readonly label?: string
}

/**
 * Milliseconds between two individually sent key presses.
 *
 * MEASURED 2026-10-14 on the sandbox 0.15.0 settings screen: keys sent as ONE `send-keys` batch all
 * land in the same Ink input tick, and the screen's `setFocusIndex(effFocus + 1)` reads `effFocus`
 * from that tick's closure — so a burst of N Downs moves the focus exactly ONE row. Keys must
 * therefore be sent one at a time with a render in between.
 */
const KEY_GAP_MS = 160

/**
 * Send a sequence of keys one at a time, leaving the host a render between them.
 * @param socket The lane's private tmux socket.
 * @param keys The tmux key names to send, in order.
 */
function pressKeys(socket: string, keys: readonly string[]): void {
  for (const key of keys) {
    tmux(socket, ["send-keys", "-t", "tui", key])
    sleepMs(KEY_GAP_MS)
  }
}

/**
 * Focus one settings row and activate it with Enter, hunting adaptively.
 *
 * The screen windows around focus, so the driver NEVER assumes a fixed layout: every iteration
 * captures the pane, measures the distance from the focused line to the target line, presses that
 * many Up/Down keys ONE AT A TIME, and retries — the row is activated only when the pointer is ON it.
 * @param root The sandbox root the running lifecycle owns.
 * @param lane The lane slug of the running lifecycle (names the private socket).
 * @param matches The row predicate: true for the line this driver must reach.
 * @param say The lane's log line sink, for the measured hops.
 * @param options The hunt's budget, off-window step and label.
 * @returns The pane text captured right after the activation, or `undefined` when the row stayed unreachable.
 */
function focusAndActivate(root: string, lane: string, matches: (line: string) => boolean, say: (line: string) => void, options: FocusHuntOptions = {}): string | undefined {
  /** The hunt's resolved tuning: generous enough for the 92-row root page and its subpages. */
  const { budget = 60, step = 6, label = "target" } = options
  /** The private socket of the running lifecycle. */
  const socket = laneSocket(root, lane)
  for (let round = 0; round < budget; round++) {
    /** The pane as it stands now. */
    const pane = captureTuiPane(root, lane)
    /** The lines of that pane, for the index math below. */
    const lines = pane.split("\n")
    /** The first line the predicate accepts, when one is visible. */
    let target: number | undefined
    for (let index = 0; index < lines.length; index++) {
      if (matches(lines[index])) { target = index; break }
    }
    /** The focused line's index, when a pointer is on screen. */
    const focus = focusedLine(pane)
    if (target !== undefined && focus !== undefined) {
      /** The signed distance from focus to target: positive sends Down, negative Up. */
      const distance = target - focus
      if (distance === 0) {
        tmux(socket, ["send-keys", "-t", "tui", "Enter"])
        sleepMs(3_000)
        return captureTuiPane(root, lane)
      }
      // One key at a time (see KEY_GAP_MS), one hop per capture.
      pressKeys(socket, Array<string>(Math.abs(distance)).fill(distance > 0 ? "Down" : "Up"))
      continue
    }
    // No visible target: hunt downward past the focus-follow window, then look again.
    pressKeys(socket, Array<string>(step).fill("Down"))
    say("hunt[" + label + "] round " + (round + 1) + ": target visible=" + String(target !== undefined) + " focus=" + String(focus))
  }
  return undefined
}

/** The mutable record the interactive hook fills in, so its captures reach the lane's assertions and evidence. */
interface DriveRecord {
  /** The pane captured right after the `侧栏` group row was activated; `undefined` when the hop failed. */
  groupPagePane?: string
  /** True when the picker showed BOTH of our rows CHECKED before any removal — the pre-state the arm needs. */
  preStateChecked?: boolean
  /** The pane captured after the FIRST plugin row was unticked; `undefined` when the row stayed unreachable. */
  firstTogglePane?: string
  /** The pane captured after the SECOND plugin row was unticked. */
  secondTogglePane?: string
  /** The panes captured around the builtin re-apply trigger's two activations, in order. */
  builtinToggles: string[]
  /** True when a builtin row was found and toggled twice (the two extra settings-apply hops). */
  builtinTriggerDone: boolean
}

/**
 * True when a captured pane is the side-panel group SUBPAGE — the breadcrumb the settings screen
 * paints as `插件设置 › dsh-tui › 侧栏` / `Settings › dsh-tui › Side panel` once the group row opened.
 *
 * The breadcrumb is searched across the HEAD BAND, not line 0: `tmux capture-pane -p -J` pads the
 * capture with a leading blank line (measured 2026-10-14), so a strict first-line read reported
 * `opened=false` on a subpage that had in fact opened.
 * @param paneText The pane captured right after the group-row activation.
 * @returns True when the head band carries the host section's breadcrumb.
 */
export function isSidePanelSubpage(paneText: string): boolean {
  /** The first lines of the capture: title row, breadcrumb and the first card border. */
  const head = paneText.split("\n").slice(0, 5)
  return head.some((line) => /›\s*dsh-tui\s*›/.test(line))
}

/** The offline arm: the CSV detector, the user-layer reader/writer, the row matcher and the pointer finder, each with a negative control. */
function selfTest(): void {
  /** The bound assertion collector and its failure list; empty at the end means the arm is green. */
  const { check, problems } = makeChecks()

  // The CSV tokenizer: the host's own normalization (split, trim, lowercase, drop empties).
  check(JSON.stringify(csvTokens(" Todo, jobs ,,ACT1:Team ")) === JSON.stringify(["todo", "jobs", "act1:team"]), "csvTokens must normalize the way the host's settings layer does: " + JSON.stringify(csvTokens(" Todo, jobs ,,ACT1:Team ")))
  // The act-prefix detector: ours and only ours.
  check(JSON.stringify(actPrefixedTokens(["todo", "act1:team", "act2:workmate", "companion"])) === JSON.stringify(["act1:team", "act2:workmate"]), "actPrefixedTokens must keep exactly the act-prefixed tokens")
  check(actPrefixedTokens(csvTokens("todo,jobs,agents")).length === 0, "a builtin-only CSV must carry no act-prefixed token")

  // The user-layer reader: the host shape, the legacy nest, absent and corrupt.
  check(userLayerPanelsCsv(JSON.stringify({ version: 1, values: { sidePanel: { panels: "todo,jobs,act1:team" } } })) === "todo,jobs,act1:team", "the HOST-document shape (`values.sidePanel.panels`) must be read")
  check(userLayerPanelsCsv(JSON.stringify({ "dsh-tui": { sidePanel: { panels: "todo,jobs,act1:team" } } })) === "todo,jobs,act1:team", "the nested user layer must be read")
  check(userLayerPanelsCsv(JSON.stringify({ other: { sidePanel: { panels: "x" }, keep: 1 }, "dsh-tui": { sidePanel: { panels: "todo" } } })) === "todo", "a sibling namespace's panels must not shadow the dsh-tui one")
  check(userLayerPanelsCsv("{ not json") === undefined, "a corrupt document must answer undefined, never throw")

  // The settings-row matcher: both host languages, checked and unchecked, builtin rows ignored,
  // and the pointer glyph read where the REAL screen paints it — inside the card border.
  /** The fixture pane: a builtin row, our two plugin rows and a pointer row, card-bordered as the host paints them. */
  const fixture = [
    "  │ 侧栏面板",
    "  │ [✓ ] · 待办  面板：待办事项",
    "  │ [✓ ] ◆ MPD 团队  插件面板（act1）",
    "  │ ❯ [  ] ◆ MPD 工作伙伴  插件面板（act2）",
    "  │ [✓ ] · btw  面板：btw",
  ].join("\n")
  /** The plugin rows the matcher found in the fixture. */
  const rows = pluginPanelRows(fixture)
  check(rows.length === 2, "the matcher must find both plugin rows: " + JSON.stringify(rows))
  check(rows[0]?.checked === true && rows[1]?.checked === false, "the matcher must read each row's checkbox state")
  check(focusedLine(fixture) === 3, "the pointer finder must locate the focused row inside the card border")
  check(focusedLine("  │ [✓ ] · btw  面板：btw") === undefined, "the pointer finder must answer undefined when no row is focused")

  // The group-row hop: the picker is only reachable through the host's page-mode `侧栏` group row.
  check(sidePanelGroupRow("  侧栏" + " ".repeat(40) + "›"), "the group-row matcher must accept the `侧栏 … ›` row")
  check(sidePanelGroupRow("  Side panel" + " ".repeat(30) + "›"), "the group-row matcher must accept the English spelling")
  check(!sidePanelGroupRow("  │ [✓ ] · 待办  面板：待办事项"), "the group-row matcher must reject a checkbox row")
  check(!sidePanelGroupRow("启动时展开侧栏"), "the group-row matcher must reject a label without the page-mode chevron")
  check(isSidePanelSubpage("\n  插件设置 › dsh-tui › 侧栏" + " ".repeat(20) + "16/24\n  ╭─ 卡片 ─╮"), "the subpage detector must accept a breadcrumb under the leading blank line")
  check(!isSidePanelSubpage("\n  插件设置" + " ".repeat(20) + "1/92\n  │ [✓ ] · 待办"), "the subpage detector must reject the root list")

  // The readiness pattern: two-sided — it must ACCEPT the ready chat screen and REJECT the splash,
  // which draws the same `❯` prompt glyph (the measured early-match trap this lane boots around).
  /** A ready chat screen: the prompt box, the status line, no boot-overlay marker. */
  const readyScreen = "  ╭───╮\n  ⌸ ❯ \n  ╰───╯\n   deepseek-flash · max · ws"
  /** A booting screen: the same prompt glyph plus the host's own "starting" overlays. */
  const bootingScreen = "  ⌸ ❯\n  正在启动 DSH… · deepseek-flash · max · ws"
  /** The command-palette hint the host shows while a boot is still in flight. */
  const stillStarting = "  │ ❯ settings     查看和编辑插件设置 │\n  ╰─DSH 还在启动——就绪后按 Enter 发送─╯"
  check(TUI_READY_PATTERN.test(readyScreen), "the readiness pattern must accept the ready chat screen")
  check(!TUI_READY_PATTERN.test(bootingScreen), "the readiness pattern must reject the splash (it draws the same prompt glyph)")
  check(!TUI_READY_PATTERN.test(stillStarting), "the readiness pattern must reject the still-starting palette hint")

  // The user-layer writer round-trip: the negative control's own mechanics, offline.
  /** A throwaway document path under the system temp root (unique per run; the lane never ships it). */
  const tempFile = join(process.env.TMPDIR ?? "/tmp", "tui-keeper-selftest-" + String(process.pid) + ".json")
  try {
    writeUserLayerPanelsCsv(tempFile, "todo,jobs")
    writeUserLayerPanelsCsv(tempFile, "todo,jobs," + CONTROL_TOKEN)
    /** The CSV as re-read through the SAME detector the live control uses. */
    const reread = userLayerPanelsCsv(readFileSync(tempFile, "utf8")) ?? ""
    check(actPrefixedTokens(csvTokens(reread)).includes(CONTROL_TOKEN), "the control write must flip the detector to present")
    writeUserLayerPanelsCsv(tempFile, "todo,jobs")
    /** The CSV as re-read after the restore, through the same detector. */
    const restored = userLayerPanelsCsv(readFileSync(tempFile, "utf8")) ?? ""
    check(actPrefixedTokens(csvTokens(restored)).length === 0, "the restore must flip the detector back to absent")
    // The writer must produce the HOST's document shape, or the pre-state seed is a no-op the host never reads.
    /** The document as written, viewed for its host-shaped keys. */
    const written = JSON.parse(readFileSync(tempFile, "utf8")) as { version?: unknown; values?: { sidePanel?: { panels?: unknown } } }
    check(written.version === 1 && written.values?.sidePanel?.panels === "todo,jobs", "the writer must produce the host's `{version, values:{sidePanel:{panels}}}` shape")
  } finally {
    rmSync(tempFile, { force: true })
  }

  /** Absolute path of the skill's case table, which must list this lane. */
  const skill = join(REPO, "skills", "dsh-qa", "SKILL.md")
  check(existsSync(skill) && readFileSync(skill, "utf8").includes("| tui-keeper-standdown |"), "the case table does not list tui-keeper-standdown")

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: csv detector, user-layer reader/writer, row matcher, pointer finder and readiness pattern are two-sided")
}

/** The live arm: one real boot, both panels unticked via `/settings`, the stay-removed window, then the reddening control. */
async function real(): Promise<void> {
  /** Every argument after the script path, so the parser and the flags see the same list. */
  const argv = process.argv.slice(2)
  /** The resolved sandbox root the whole run happens inside. */
  const { root } = parseSandboxArgs(argv, SLUG)
  /** The evidence directory this run writes into (created by `laneEvidenceDir`). */
  const outDir = laneEvidenceDir(SLUG)
  /** The dist revision before the run, re-measured at evidence-write time. */
  const revisionBefore = artifactRevision()
  /** Every progress line, joined and written as `output.log` at the end. */
  const log: string[] = []
  /** Append one line to the log and echo it with the lane prefix. */
  const say = (line: string): void => { log.push(line); console.log("[" + SLUG + "] " + line) }

  /** The sandbox `dsh-tui` profile facts the prerequisite gate is decided from. */
  const state = profileState(root)
  gateTuiPrereqs(SLUG, tuiPrereqs({ sandboxPresent: () => state.present && state.hasHost && state.hasBundle }))

  // THE FIXTURE STEP this lane owns (the two file-shaped 0.13.0 gates): the first-run wizard's skip
  // flag and the `mpd` agent preset. Without the preset the session runs the host's own default
  // (`standard`) and every MPD panel stays unmounted, so the drive would hunt for rows that can
  // never render and the arm would report a false absence.
  const homeFixture = provisionTuiHome(root)
  say("dsh-tui home fixture=" + homeFixture.evidence.join(", ") + " preset=" + homeFixture.preset)

  /** The host's settings.json inside this sandbox — the user layer both the save path and the control write. */
  const settingsFile = join(sandboxDataDir(root), "settings.json")
  // THE PRE-STATE the removal needs: the user layer exactly as a session that has BOTH MPD panels
  // ENABLED. The host resolves `sidePanel.panels` for the picker from this document (NOT from the
  // live store its registry feeds), so a wiped/absent layer resolves to the builtin default only
  // and our registered rows render UNCHECKED — there is then nothing to remove (measured
  // 2026-10-14). The seed is written in the host's own document shape.
  rmSync(settingsFile, { force: true })
  writeUserLayerPanelsCsv(settingsFile, BUILTIN_PANEL_CSV + "," + MPD_PANEL_IDS.join(","))
  say("user layer seeded with both MPD panels enabled: " + MPD_PANEL_IDS.join(","))

  /** The interactive hook's record, filled during the drive and read by the assertions below. */
  const drive: DriveRecord = { builtinToggles: [], builtinTriggerDone: false }
  /** The one lifecycle: boot, open `/settings`, untick both plugin rows, toggle a builtin twice, back to chat. */
  const steps: TuiStep[] = [
    { name: "settings-open", keys: ["/settings", "Enter"], waitMs: 9_000 },
    {
      name: "both-panels-unticked",
      // The whole removal runs interactively inside the hook: capture → measure → press → capture.
      before: () => {
        /** True for a STILL-CHECKED plugin-panel row line (the host's own description marker plus its checkbox). */
        const isPluginRowChecked = (line: string): boolean => pluginPanelRows(line).length > 0 && line.includes("[✓")
        // The picker does NOT live on the settings root page: the `side-panel` group is a page-mode
        // group, so the drive first opens its subpage (the ONLY place a `插件面板（actN）` row renders).
        drive.groupPagePane = focusAndActivate(root, SLUG, sidePanelGroupRow, say, { budget: 45, step: 6, label: "root/side-panel-group" })
        /** The subpage capture, when the hop landed. */
        const groupPage = drive.groupPagePane
        /** True when the activation landed on the group SUBPAGE and not still on the root list. */
        const onSubpage = groupPage !== undefined && isSidePanelSubpage(groupPage)
        say("side-panel group hop: opened=" + onSubpage)
        if (!onSubpage) return
        // ARM (a) — the PRE-STATE: both of our rows render CHECKED on the picker before any removal.
        /** The picker rows the SUBPAGE rendered before any removal. */
        const preRows = pluginPanelRows(groupPage)
        drive.preStateChecked = preRows.length >= 2 && preRows.every((row) => row.checked)
        say("pre-state picker rows=" + preRows.length + " checked=" + preRows.filter((row) => row.checked).length)
        // Each activation unticks the first still-checked plugin row; the second call therefore
        // reaches the OTHER one — a row that re-ticked would make the second hunt find nothing.
        drive.firstTogglePane = focusAndActivate(root, SLUG, isPluginRowChecked, say, { budget: 30, step: 4, label: "picker/untick-1" })
        if (drive.firstTogglePane !== undefined) drive.secondTogglePane = focusAndActivate(root, SLUG, isPluginRowChecked, say, { budget: 30, step: 4, label: "picker/untick-2" })
        // The re-apply trigger: two more settings-apply hops past our removal — a checked
        // NON-plugin row is toggled twice (off then back on), and each save re-runs the very
        // settings-apply path a repairing keeper used to ride.
        /** True for a checked row that is not one of ours (the first builtin or boolean row in reach). */
        const isBuiltinRow = (line: string): boolean => line.includes("[✓") && !isPluginRowChecked(line)
        /** The pane after the trigger's first activation. */
        const first = focusAndActivate(root, SLUG, isBuiltinRow, say, { budget: 20, step: 4, label: "subpage/builtin-off" })
        if (first !== undefined) {
          drive.builtinToggles.push(first)
          /** The pane after the trigger's second activation (an unchecked row toggled back on). */
          const second = focusAndActivate(root, SLUG, (line: string): boolean => line.includes("[  ]") && !isPluginRowChecked(line), say, { budget: 20, step: 4, label: "subpage/builtin-on" })
          if (second !== undefined) {
            drive.builtinToggles.push(second)
            drive.builtinTriggerDone = true
          }
        }
      },
      keys: [],
      waitMs: 6_000,
    },
    { name: "back-to-chat", keys: ["Escape"], waitMs: 3_000 },
  ]
  /** The one real lifecycle: boot, open `/settings`, untick both plugin rows adaptively, toggle a builtin twice, back to chat. */
  const session = runTuiSession({ lane: SLUG, root, outDir, bootWaitMs: 150_000, readyPattern: TUI_READY_PATTERN, paneWidth: 320, steps })
  for (const failure of session.failures) say("tmux: " + failure)

  // ARM (a)/(b) — both plugin rows unticked in the panes the drive itself captured.
  /** The plugin rows the pane shows after the FIRST untick (the second must already be unchecked there only if it was below). */
  const afterFirst = drive.firstTogglePane === undefined ? [] : pluginPanelRows(drive.firstTogglePane)
  /** The plugin rows the pane shows after the SECOND untick — BOTH must be unchecked now. */
  const afterSecond = drive.secondTogglePane === undefined ? [] : pluginPanelRows(drive.secondTogglePane)
  /** True when both rows were reached and both render unchecked after the second activation. */
  const untickedInPane = afterSecond.length >= 2 && afterSecond.every((row) => !row.checked)
  say("pane after first untick: rows=" + afterFirst.length + " checked=" + afterFirst.filter((row) => row.checked).length)
  say("pane after second untick: rows=" + afterSecond.length + " checked=" + afterSecond.filter((row) => row.checked).length)

  // ARM (c) — the stay-removed window: poll the user layer across settle rounds.
  /** One observation round: the CSV as stored, and whether an act token is in it. */
  const observe = (): { csv: string | undefined; actTokens: string[] } => {
    /** The user-layer CSV, `undefined` when the file or the nesting is absent. */
    const csv = existsSync(settingsFile) ? userLayerPanelsCsv(readFileSync(settingsFile, "utf8")) : undefined
    return { csv, actTokens: csv === undefined ? [] : actPrefixedTokens(csvTokens(csv)) }
  }
  /** The stay-removed observations, one per settle round. */
  const observations: { csv: string | undefined; actTokens: string[] }[] = []
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    observations.push(observe())
    if (round < SETTLE_ROUNDS - 1) sleepMs(SETTLE_INTERVAL_MS)
  }
  /** True when the FIRST observation is a stored CSV carrying no act token — the removal landed. */
  const removed = observations[0]?.csv !== undefined && observations[0].actTokens.length === 0
  /** True when EVERY observation carried no act token — nothing repaired it. */
  const staysRemoved = removed && observations.every((observation) => observation.actTokens.length === 0)
  for (let round = 0; round < observations.length; round++) {
    say("settle[" + round + "] csv=" + JSON.stringify(observations[round]?.csv) + " actTokens=" + JSON.stringify(observations[round]?.actTokens))
  }
  say("builtin re-apply trigger fired twice: " + drive.builtinTriggerDone)

  // ARM (d) — the NEGATIVE CONTROL: a hand write of the exact token a repairing keeper would add
  // MUST flip the SAME detector; the restore MUST flip it back. A control that cannot redden
  // makes the whole stay-removed observation void.
  /** The pruned CSV to restore after the control, taken from the last observation. */
  const prunedCsv = observations[observations.length - 1]?.csv ?? "todo,jobs,agents,info,trajectory,workspace,btw,companion"
  writeUserLayerPanelsCsv(settingsFile, prunedCsv + "," + CONTROL_TOKEN)
  /** The detector's answer with the control token in place. */
  const controlObservation = observe()
  /** True when the hand-written control token flipped the detector to present — the control's red half. */
  const controlReddened = controlObservation.actTokens.includes(CONTROL_TOKEN)
  writeUserLayerPanelsCsv(settingsFile, prunedCsv)
  /** The detector's answer after the restore. */
  const restoredObservation = observe()
  /** True when the detector flipped back to absent — the control's green half. */
  const controlRestored = restoredObservation.actTokens.length === 0
  say("negative control: reddened=" + controlReddened + " restored=" + controlRestored)

  /** The lane verdict: a clean lifecycle, the checked pre-state, both rows unticked, the removal landed, stayed, and the control reddened and restored. */
  const ok = session.failures.length === 0 && drive.preStateChecked === true && drive.firstTogglePane !== undefined && drive.secondTogglePane !== undefined
    && untickedInPane && removed && staysRemoved && controlReddened && controlRestored
  /** The dist revision at evidence-write time, compared with the start-of-run reading. */
  const revisionAfter = artifactRevision()
  /** The digest comparison the REVISION.json records; a change voids this run. */
  const { delta } = writeRevisionFile(outDir, {
    before: revisionBefore,
    after: revisionAfter,
    composition: { sandboxRoot: root.replace(REPO + "/", ""), profile: "dsh-tui" },
  })
  if (delta.changed) {
    console.error("[" + SLUG + "] FAIL: " + delta.reason)
    process.exit(1)
  }
  // The drive's own panes, written verbatim so a verifier reads the SAME screen the assertions read.
  for (const [name, pane] of [["group-page", drive.groupPagePane], ["after-untick-1", drive.firstTogglePane], ["after-untick-2", drive.secondTogglePane]] as const) {
    if (pane !== undefined) writeFileSync(join(outDir, name + ".pane.txt"), pane)
  }
  writeLaneEvidence(outDir, SLUG, {
    ok,
    revision: revisionAfter,
    revisionDelta: delta,
    manifestDigest: manifestDigest(),
    arms: {
      sidePanelGroupOpened: drive.groupPagePane !== undefined && isSidePanelSubpage(drive.groupPagePane),
      preStateChecked: drive.preStateChecked === true,
      rowsReached: drive.firstTogglePane !== undefined && drive.secondTogglePane !== undefined,
      untickedInPane,
      removed,
      staysRemoved,
      builtinTriggerDone: drive.builtinTriggerDone,
      controlReddened,
      controlRestored,
    },
    controlToken: CONTROL_TOKEN,
    observations: observations.map((observation) => ({ csv: observation.csv, actTokens: observation.actTokens })),
    sandboxRoot: root,
    settingsFile: settingsFile.replace(REPO + "/", ""),
  }, log.join("\n"))
  if (!ok) {
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify({ failures: session.failures.length, sidePanelGroupOpened: drive.groupPagePane !== undefined && isSidePanelSubpage(drive.groupPagePane), preStateChecked: drive.preStateChecked === true, rowsReached: drive.firstTogglePane !== undefined && drive.secondTogglePane !== undefined, untickedInPane, removed, staysRemoved, controlReddened, controlRestored }))
    process.exit(1)
  }
  console.log("[" + SLUG + "] PASS: both panels unticked via /settings, removal stayed through " + SETTLE_ROUNDS + " polls and the control reddened")
}

// Entry guard: importing this lane must never start a live run; the self-test and the real lane
// run only when this file IS the process entry point.
/** True only when this module is the process entry point, never when it is imported. */
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest()
  else await real()
}
