#!/usr/bin/env node
// docker/lib/tui-panel-body.ts — decide, from CAPTURED PANE BYTES, whether the merged panel opened,
// and in which order its two sections are drawn.
//
// WHY THIS IS A MODULE AND NOT A BASH GREP (2026-10-09, §4 S-B criterion 4). `docker/tui-lane.sh`
// recorded `tui.mergedPanelOpens` / `tui.mergedPanelOrder` as NULL on any host offering the 0.13.0
// `ctx.tuiPanels` seam, on the recorded ground that "a host-ACCEPTED open() changes zero bytes of a tmux
// capture". That ground was measured on the PRE-0.13 full-screen scene and never re-measured after the
// host moved the merged view into a SIDEBAR PANEL: the authoritative run's own `tui-panes/pane-merged.txt`
// carries the whole panel body (its tab bar, the host's subagent section, the team header and the DAG
// footer) while the pre-key capture `pane-teamClosed.txt` carries none of it. A row that is structurally
// unmeasurable and a row nobody re-measured look identical in a report; this module makes the second
// impossible to repeat, because the same classifier now runs BOTH in the container and OFFLINE in
// `scripts/docker-e2e.ts --self-test` against planted panes.
//
// THE CONTROL IS HALF THE MEASUREMENT. A pane captured AFTER the combo proves the panel is on screen; it
// does NOT prove the combo is what put it there. So the module also reads the PRE-KEY capture: if that
// pane already carries the panel body, the open cannot be attributed to the keypress and the verdict is
// FALSE with that reason — the falsifier, not a footnote.
//
// Usage:
//   node docker/lib/tui-panel-body.ts --pane <captured.txt> [--control <pre-key.txt>]
//     [--shape present|absent] [--json <file>]
//
// Output contract (the shell greps these prefixes):
//   [tui-panel] SHAPE=present|absent
//   [tui-panel] TITLE_HITS=<n> SUB_HITS=<n> TEAM_HITS=<n> CONTROL_HITS=<n>
//   [tui-panel] SUB_LINE=<n> TEAM_LINE=<n> HEAD_LINE=<n> EMPTY_LINE=<n>
//   [tui-panel] OPENS=true|false
//   [tui-panel] ORDER=true|false
//   [tui-panel] REASON=<one line, the measurement behind the two verdicts>
// Exit code: 0 when the pane was readable (whatever the verdict), 2 when it was not.
import { existsSync, readFileSync, writeFileSync } from "node:fs"

/** The two host generations the merged view can be drawn by, selected by the caller's seam probe. */
type Shape = "present" | "absent"

/** One marker family: the patterns that prove a section is on the pane, and what the section is. */
interface MarkerFamily {
  /** The section's name, for the reason line. */
  readonly label: string
  /** The patterns whose FIRST hit line is the section's marker; any one of them counts as present. */
  readonly patterns: readonly RegExp[]
}

/** The measured evidence for one captured pane. */
interface PaneReading {
  /** How many lines carry a marker of the title family. */
  readonly titleHits: number
  /** How many lines carry a marker of the subagent family. */
  readonly subHits: number
  /** How many lines carry a marker of the team-body family. */
  readonly teamHits: number
  /** The 1-based line of the first subagent-section marker, or 0 when there is none. */
  readonly subLine: number
  /** The 1-based line of the first team-body marker, or 0 when there is none. */
  readonly teamLine: number
  /** The 1-based line of the subagent section HEADER marker, or 0 when there is none. */
  readonly headLine: number
  /** The 1-based line of the host's own subagent empty-state marker, or 0 when there is none. */
  readonly emptyLine: number
}

/** The module's verdict, printed as the output contract above and (optionally) written as JSON. */
interface Verdict {
  /** Which host generation the markers were chosen for. */
  readonly shape: Shape
  /** Whether the combo opened the merged panel, control included. */
  readonly opens: boolean
  /** Whether the subagent section sits ABOVE the team body on the captured pane. */
  readonly order: boolean
  /** The pane reading the verdict rests on. */
  readonly pane: PaneReading
  /** How many marker hits the PRE-KEY capture carries; a non-zero value voids the attribution. */
  readonly controlHits: number
  /** The one-line measurement behind both verdicts. */
  readonly reason: string
}

// ── the marker families, one set per host generation ──────────────────────────
// PRESENT (dsh-tui >= 0.13.0, the `ctx.tuiPanels` sidebar): the merged view is the MPD sidebar panel, so
// its title is the panel chrome rather than a full-screen heading — the tab bar with the MPD tab active
// (`◀ ○ ○ ○ ○ MPD ○ … ▶`) and the panel border carrying the panel's own name (`┌MPD───`). The subagent
// section is the HOST's own section (its summary line and, for a session with no host subagent row, its
// empty state); the team body is MPD's team header (the phase/task/member line) and its DAG footer.
/** The sidebar panel's title chrome — either the active tab in the sidebar's tab bar or its border. */
const PANEL_TITLE_PRESENT: MarkerFamily = { label: "panel chrome", patterns: [/┌MPD/, /◀[^\n]*\bMPD\b[^\n]*▶/] }
/** The host's own subagent section inside the panel: its summary line, or its empty state. */
const PANEL_SUB_PRESENT: MarkerFamily = { label: "subagent section", patterns: [/subagents +[0-9]+ total/, /No subagents in the current session/] }
/** MPD's team body inside the panel: the team header line, or the rendered DAG's own footer. */
const PANEL_TEAM_PRESENT: MarkerFamily = { label: "team body", patterns: [/phase [a-z]+ +tasks +[0-9]+\/[0-9]+/, /view boxes · [0-9]+ tasks/] }

// ABSENT (pre-0.13.0): the merged view is the ORIGINAL full-screen scene, whose markers the lane has
// used since the scene existed. Kept so a host without the seam keeps its exact previous meaning.
/** The pre-0.13 full-screen scene's own heading. */
const SCENE_TITLE_ABSENT: MarkerFamily = { label: "scene title", patterns: [/MPD subagents \+ team/] }
/** The pre-0.13 scene's subagent section (the same host section, drawn full-screen). */
const SCENE_SUB_ABSENT: MarkerFamily = { label: "subagent section", patterns: [/subagents +[0-9]+ total/, /No subagents in the current session/] }
/** The pre-0.13 scene's team body: its graph heading or the dependency-graph placeholder. */
const SCENE_TEAM_ABSENT: MarkerFamily = { label: "team body", patterns: [/build the graph/, /task dependency graph/] }

/** The subagent section HEADER, used only to name the branch in the raw witness. */
const SUB_HEADER: MarkerFamily = { label: "subagent header", patterns: [/subagents +[0-9]+ total/] }
/** The host's own subagent EMPTY STATE, used only to name the branch in the raw witness. */
const SUB_EMPTY: MarkerFamily = { label: "subagent empty state", patterns: [/No subagents in the current session/] }

/** The command line this script was invoked with, minus the node executable and script path. */
const argv: string[] = process.argv.slice(2)
/** Read `--<flag> <value>` off the command line, or `fallback` when the flag is absent/valueless. */
const arg = (flag: string, fallback: string = ""): string => {
  // Index of the flag token, or -1 when the caller never passed it.
  const index = argv.indexOf("--" + flag)
  return index === -1 || index + 1 >= argv.length ? fallback : argv[index + 1]
}
/** The captured pane to classify. */
const panePath: string = arg("pane")
/** The PRE-KEY capture, when the caller has one: the control half of the measurement. */
const controlPath: string = arg("control")
/** The marker generation to use, forced by the caller's own seam probe. */
const shapeArg: string = arg("shape", "present")
/** Optional JSON destination for the same verdict, for a caller that prefers a structured record. */
const jsonPath: string = arg("json")
if (panePath === "") {
  process.stderr.write("[tui-panel] usage: tui-panel-body.ts --pane <captured.txt> [--control <pre-key.txt>] [--shape present|absent] [--json <file>]\n")
  process.exit(2)
}
/** The marker generation, defaulting to the panel-body set only for an unrecognised value. */
const shape: Shape = shapeArg === "absent" ? "absent" : "present"
/** The three families in force for this run: title, subagent section, team body. */
const families: readonly [MarkerFamily, MarkerFamily, MarkerFamily] = shape === "present"
  ? [PANEL_TITLE_PRESENT, PANEL_SUB_PRESENT, PANEL_TEAM_PRESENT]
  : [SCENE_TITLE_ABSENT, SCENE_SUB_ABSENT, SCENE_TEAM_ABSENT]

/**
 * Read a captured pane as lines, or `null` when it is absent or unreadable.
 *
 * @param path - The capture file.
 * @returns Its lines (trailing empty line dropped), or `null`.
 */
function readPane(path: string): string[] | null {
  if (path === "" || !existsSync(path)) return null
  try {
    /** The file's text, split into lines; `\r` is stripped so a CRLF capture reads the same. */
    const lines = readFileSync(path, "utf8").replace(/\r/g, "").split("\n")
    // A trailing newline produces one empty final element; it carries no marker either way.
    return lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines
  } catch {
    return null
  }
}

/**
 * Count the lines carrying a marker of one family, and the 1-based line of the first of them.
 *
 * @param lines - The pane's lines.
 * @param family - The marker family to count.
 * @returns The hit count and the first hit's 1-based line (0 when there is none).
 */
function countFamily(lines: readonly string[], family: MarkerFamily): { hits: number; firstLine: number } {
  /** The number of lines carrying at least one of the family's patterns. */
  let hits = 0
  /** The 1-based line of the first such line, or 0 when the family never matched. */
  let firstLine = 0
  for (let index = 0; index < lines.length; index += 1) {
    if (!family.patterns.some((pattern) => pattern.test(lines[index]))) continue
    hits += 1
    if (firstLine === 0) firstLine = index + 1
  }
  return { hits, firstLine }
}

/**
 * Decide both verdicts from the post-key capture and the pre-key control.
 *
 * @param paneLines - The lines of the capture taken AFTER the combo.
 * @param controlLines - The lines of the PRE-KEY capture, or `null` when none was supplied.
 * @returns The verdict, including the measurement behind it.
 */
function classify(paneLines: readonly string[], controlLines: readonly string[] | null): Verdict {
  /** The title family's reading. */
  const title = countFamily(paneLines, families[0])
  /** The subagent family's reading. */
  const sub = countFamily(paneLines, families[1])
  /** The team-body family's reading. */
  const team = countFamily(paneLines, families[2])
  /** The subagent header's own line, for the raw witness. */
  const head = countFamily(paneLines, SUB_HEADER)
  /** The host empty state's own line, for the raw witness. */
  const empty = countFamily(paneLines, SUB_EMPTY)
  /** How many lines of the CONTROL capture carry any of the three marker families. */
  const controlHits = controlLines === null
    ? 0
    : families.reduce((total, family) => total + countFamily(controlLines, family).hits, 0)
  /** The reading of the graded pane, restated so the verdict carries its own measurement. */
  const pane: PaneReading = {
    titleHits: title.hits,
    subHits: sub.hits,
    teamHits: team.hits,
    subLine: sub.firstLine,
    teamLine: team.firstLine,
    headLine: head.firstLine,
    emptyLine: empty.firstLine,
  }
  // THE CONTROL IS CHECKED FIRST: a control that already carries the body makes every other number here
  // uninterpretable, and reporting the pane's markers as a pass in that state is the exact class of
  // claim this module exists to refuse.
  if (controlLines === null) {
    return { shape, opens: false, order: false, pane, controlHits, reason: "no pre-key capture was supplied, so the open cannot be attributed to the combo: " + describe(pane) }
  }
  if (controlHits > 0) {
    return { shape, opens: false, order: false, pane, controlHits, reason: "the PRE-KEY capture already carries " + controlHits + " panel-body marker line(s), so the post-key pane cannot show what the combo opened: " + describe(pane) + " controlHits=" + controlHits }
  }
  /** Whether the pane carries the panel's title, the subagent section and the team body together. */
  const opens = title.hits > 0 && sub.hits > 0 && team.hits > 0
  /** Whether the subagent section is drawn ABOVE the team body — meaningful only for an open panel. */
  const order = opens && sub.firstLine > 0 && team.firstLine > 0 && sub.firstLine < team.firstLine
  return {
    shape,
    opens,
    order,
    pane,
    controlHits,
    reason: opens
      ? "the captured pane carries the merged panel: " + describe(pane) + " (each family must be > 0, pre-key control hits = 0)"
      : "the captured pane does NOT carry the merged panel: " + describe(pane) + " (each family must be > 0, pre-key control hits = 0)",
  }
}

/**
 * Render a pane reading as the one-line witness the reason strings quote.
 *
 * @param pane - The measured reading.
 * @returns The reading as `key=value` pairs.
 */
function describe(pane: PaneReading): string {
  return "titleHits=" + pane.titleHits + " subagentHits=" + pane.subHits + " teamHits=" + pane.teamHits +
    " subagentMarker=line " + pane.subLine + " teamMarker=line " + pane.teamLine +
    " header=line " + pane.headLine + " emptyState=line " + pane.emptyLine
}

/** The lines of the graded pane, or `null` when the capture is missing. */
const paneLines = readPane(panePath)
if (paneLines === null) {
  process.stderr.write("[tui-panel] cannot read the captured pane: " + (panePath === "" ? "<none passed>" : panePath) + "\n")
  process.exit(2)
}
/** The lines of the pre-key control capture, or `null` when the caller passed none. */
const controlLines = controlPath === "" ? null : readPane(controlPath)
/** The verdict both callers (the lane's `record()` and the offline self-test) read. */
const verdict: Verdict = classify(paneLines, controlLines)
console.log("[tui-panel] SHAPE=" + verdict.shape)
console.log("[tui-panel] TITLE_HITS=" + verdict.pane.titleHits + " SUB_HITS=" + verdict.pane.subHits + " TEAM_HITS=" + verdict.pane.teamHits + " CONTROL_HITS=" + verdict.controlHits)
console.log("[tui-panel] SUB_LINE=" + verdict.pane.subLine + " TEAM_LINE=" + verdict.pane.teamLine + " HEAD_LINE=" + verdict.pane.headLine + " EMPTY_LINE=" + verdict.pane.emptyLine)
console.log("[tui-panel] OPENS=" + String(verdict.opens))
console.log("[tui-panel] ORDER=" + String(verdict.order))
console.log("[tui-panel] REASON=" + verdict.reason)
if (jsonPath !== "") writeFileSync(jsonPath, JSON.stringify({ ...verdict, panePath, controlPath }, null, 2) + "\n")
// Exit 0 whatever the verdict: this module REPORTS a measurement, and its caller owns the row. Only an
// unreadable pane (above) is a usage failure.
process.exit(0)
