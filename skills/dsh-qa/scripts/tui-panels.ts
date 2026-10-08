#!/usr/bin/env bun
// Case tui-panels: drive the REAL dsh-TUI with send-keys and assert that each of
// the seven activation-gated seam surfaces really RENDERS — a seam that renders
// nothing is a FAILED item here, never a vacuous pass.
//
// Surfaces exercised (identifiers read from packages/mpd-tui-plugin/src/*):
//   • tuiStatus        — the keyed line `mpd: team … · plans N · workmates N` above the prompt;
//   • commands         — `/mpd status` prints the same status text (harness command registry);
//   • tuiCommandTrees  — `/mpd ` completion advertises the tree's children;
//   • tuiScenes        — `/mpd board` opens the full-screen scene (title `MPD board`);
//   • tuiRenderers     — the log-only `mpd-tui/board-opened` record renders a transcript row;
//   • tuiSettingsSections — `/settings` shows the `MPD bundle` section (namespace `mpd`);
//   • tuiDialogs       — `alt+w` parks a managed `select` dialog (`mpd workmates`) when the
//                        sandbox HOME holds at least one workmate (the plugin falls back to
//                        opening the board when the library is empty or the seam is absent).
//
// NEGATIVE CONTROL (`--control`, also recorded by every real run): the SAME assertion
// engine is re-run against the SAME captured panes with one expectation injected that
// cannot appear — if that does not fail, the lane cannot fail and the run is void.
//
// PREREQ: absent-dsh-binary dsh-tui "npm i -g @deepseek-harness-tui/dsh-tui@0.14.0"
// PREREQ: absent-runtime tmux "install tmux; the TUI requires a real TTY"
// PREREQ: absent-fixture tui profile in the sandbox root "bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root <root> --install"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-panels.ts --self-test
//   bun skills/dsh-qa/scripts/tui-panels.ts [--sandbox-root <dir>] [--control]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,<step>.pane.txt,negative/}
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  REPO, artifactRevision, countSessionEvents, gateTuiPrereqs, laneEvidenceDir, makeChecks, manifestDigest, parseSandboxArgs,
  profileState, provisionTuiHome, readCommandRecords, readSessionHeaders, readUserMessages, runTuiSession, sandboxSessionIds,
  tuiPrereqs, writeLaneEvidence, writeRevisionFile,
} from "./lib/tui-lane.ts"
import type { CommandDoneRecord, CommandRunRecord, TuiStep, UserMessageRecord } from "./lib/tui-lane.ts"

/** The session-store event type the renderer surface is cross-checked against. */
const BOARD_OPENED_EVENT = "mpd-tui/board-opened"

/** The case slug: names the evidence directory, the tmux socket and every log prefix of this lane. */
const SLUG = "tui-panels"

/**
 * The tmux pane geometry this lane drives.
 *
 * WIDENED 220 -> 320 (measured 2026-10-06, 0.13.0). The `/settings` section renders its ONE long
 * English disclosure hint on a single line, and at 220 columns the host truncates it in the pane
 * (`… ` before the `╮` border), so the clause `never lost` — the last phrase of the four the surface
 * asserts — is simply not painted. At 320 columns the SAME boot paints the hint as a 315-character
 * line ending `… the value is never lost… ─╮`, and all four frozen phrases match. WIDENING was chosen
 * over weakening the expectation: the four-clause disclosure stays asserted VERBATIM, so a regression
 * that dropped a clause still reddens, whereas accepting a prefix plus a truncation marker would let
 * exactly that regression through.
 */
const PANE_WIDTH = 320
/** The pane height, kept at the lane's original 50 rows so the number of visible transcript rows is unchanged. */
const PANE_HEIGHT = 50

/**
 * The keyed status line, accepted in BOTH languages the plugin itself can render.
 *
 * Composed by `statusLine()` in `packages/mpd-tui-plugin/src/state.ts` as `` `mpd: ${parts.join(" · ")}` ``,
 * whose first part is one of exactly two entries in `packages/mpd-tui-plugin/src/i18n.ts`: `status.teamRow`
 * (`团队 {name} …` / `team {name} …`) or `status.teamNone` (`团队 -` / `team -`). The English-only
 * `/mpd:\s+team /` reported a line that WAS painted as missing (measured 2026-10-06: the sandbox pane
 * carried `mpd: 团队 Fixture Team 2·1/2 · 计划 0 · workmate 1`).
 */
export const STATUS_LINE: RegExp = /mpd:\s+(?:team|团队)/

/**
 * The panel's own "the host accepted it" sentence, from `packages/mpd-tui-plugin/src/i18n.ts` key
 * `panel.opened`
 * (`mpd 侧栏面板：宿主已接受 {id}；…` / `mpd sidebar panel: the host accepted {id}; …`).
 *
 * THE OLDER WORDING THIS PATTERN USED TO CARRY (`侧栏面板：已打开` / `sidebar panel: opened`) was
 * replaced in `i18n.ts` by commit `fb7ffddc` (2026-10-06T22:27+08:00) and the matcher was not moved with
 * it (`git log -S'侧栏面板：已打开'`); `i18n.ts` is untouched by this wave, so a pattern holding the old
 * literal matches no real boot — which is exactly how this lane's panel row came to read as "no
 * panel-OPENED sentence reached the store" on a host that had accepted the open.
 *
 * This sentence is printed by `/mpd panel` through `panelStatusLine()` and only for the ONE outcome in
 * which the seam was BOUND, the host's own `list()` read-back produced an id, and `open(id)` returned
 * true — the two other outcomes have their own sentences (`panel.fallback`, `panel.unavailable`), so
 * matching this one cannot be satisfied by a fallback.
 */
export const PANEL_OPENED: RegExp = /侧栏面板：宿主已接受|sidebar panel: the host accepted/
/**
 * The `{id}` that accepted sentence names.
 *
 * The id is NOT parenthesised there: the sentence's ONLY parentheses carry the tail hint
 * (`（或开启"启动时展开侧栏"）` / `(or turn on "Side panel starts open")`), so reading the id out of the
 * first parenthesis returns that hint instead — MEASURED, `evidence/tui/lanes/2026-10-08T03-06-38.202Z/
 * result.json`: `"id": "或开启"启动时展开侧栏""`. The clause's own words are the anchor.
 */
export const PANEL_OPENED_ID: RegExp = /(?:宿主已接受|the host accepted)\s+([^\s；;，,]+)/
/** The two outcomes that must NOT be what `/mpd panel` printed: a refusal, or no seam at all. */
export const PANEL_NOT_OPENED: readonly RegExp[] = [/侧栏面板：宿主拒绝|sidebar panel: the host refused/, /该宿主不提供面板接缝|this host exposes no panel seam/]

/** One captured pane the evaluator may judge; the written path is not read here. */
export interface PaneText {
  /** Step name the pane was captured at (`boot` for the boot capture). */
  readonly name: string
  /** The pane text exactly as `capture-pane -p -J` printed it. */
  readonly text: string
}

/**
 * The structural half of a store-backed assertion: the harness's OWN command-registry records.
 *
 * The `done` half is the lane lib's {@link CommandDoneRecord} — the SAME type `readCommandRecords()`
 * returns, never a structural clone, so the fixtures below cannot drift from what the harness writes.
 * A text match alone proves a string reached the store, not that the HARNESS ran our command; the
 * `command/run` + correlated `command/done` pair is what proves the registry dispatched it and the
 * handler returned `kind` (an error kind reddens). Both halves are required.
 */
export interface StoreProof {
  /** The name the `command/run` record must carry, e.g. `mpd`. */
  readonly name: string
  /** The `command/run.args` spelling the invocation must carry. */
  readonly args: RegExp
  /** The `kind` its correlated `command/done` must carry; anything else (e.g. `error`) reddens. */
  readonly doneKind: string
}

/** The command-store slice a `source: "store"` surface is proven from. */
export interface CommandStoreSlice {
  /** The `command/done` records of THIS run; their text is one of the two sources judged. */
  readonly dones?: readonly CommandDoneRecord[]
  /** The `command/run` records of THIS run; the structural proof reads name, args and the id. */
  readonly runs?: readonly CommandRunRecord[]
}

/** The fields every judged surface row carries, whether it comes from the plan or a control. */
export interface SurfaceRow {
  /** The seam identifier this row exercises, e.g. `tuiStatus` or `tuiCommandTrees`. */
  readonly surface: string
  /** The capture step whose pane (or whose store slice) is asserted; also the evidence file name. */
  readonly step: string
  /** Where the evidence comes from: the captured pane, or the harness's own command store. */
  readonly source: "pane" | "store"
  /** The pattern the capture must match, used when `allPatterns` is absent. */
  readonly pattern: RegExp
  /** Every pattern that must match in the SAME capture; overrides `pattern` when present. */
  readonly allPatterns?: readonly RegExp[]
  /** The structural store proof a `source: "store"` row must ALSO satisfy; ignored by pane rows. */
  readonly storeProof?: StoreProof
  /** Human-readable statement of what a match proves, recorded per result. */
  readonly label: string
}

/** One planned surface: a `SurfaceRow` plus the keystroke drive that produces its capture. */
export interface SurfaceSpec extends SurfaceRow {
  /** tmux `send-keys` arguments for this step, in order; empty for a surface proven at boot. */
  readonly keys: readonly string[]
  /** Milliseconds to wait before capturing this step's pane. */
  readonly waitMs: number
  /** Settle keys sent BEFORE this step's own keys, for a step that must reach the plain chat state. */
  readonly pre?: readonly string[]
  /** Cleanup keys sent AFTER this step's own keys, to leave the keyboard in a known state. */
  readonly post?: readonly string[]
}

/** One evaluated surface: the judged row plus what the capture actually showed. */
export interface SurfaceResult {
  /** The seam identifier the row exercises. */
  readonly surface: string
  /** The step whose capture was judged. */
  readonly step: string
  /** Where the evidence came from: the captured pane, or the harness's command store. */
  readonly source: "pane" | "store"
  /** The row's own pattern, stringified for the evidence file. */
  readonly pattern: string
  /** Every required pattern, stringified (one entry unless the row declares `allPatterns`). */
  readonly requiredPatterns: string[]
  /** The required patterns that did NOT match, stringified; empty means the surface rendered. */
  readonly missingPatterns: string[]
  /** The structural store proof that did NOT hold, stringified; `[]` for pane rows that declare none. */
  readonly missingProof: string[]
  /** True when at least one pattern was required and every one of them matched. */
  readonly rendered: boolean
  /** Number of characters the store half of the judged text carried, `0` for pane rows. */
  readonly sourceChars: number
  /** Number of characters the step's pane carried, `0` when the step captured no pane. */
  readonly paneChars: number
  /** Total characters judged: the store text plus the pane text for a store row, else the pane alone. */
  readonly judgedChars: number
  /** The row's own statement of what a match proves, carried into the evidence file. */
  readonly label: string
}

/** The outcome of one surface evaluation: the overall verdict plus the per-surface results. */
export interface SurfaceEvaluation {
  /** True when every judged surface rendered, i.e. no required pattern was missing. */
  readonly ok: boolean
  /** One result per judged surface, in plan order followed by the injected extras. */
  readonly results: SurfaceResult[]
}

/** One user/message record that carried the slash-command text instead of being handled by the plugin. */
export interface ModelEchoOffender {
  /** The session the offending message was decoded from. */
  readonly sessionId: string
  /** The record's sequence number as the store wrote it. */
  readonly seq: unknown
  /** The message text, truncated to 120 characters for the failure report. */
  readonly excerpt: string
}

/** The `/mpd` echo verdict: a user/message record carrying the command text is a defect. */
export interface ModelEchoVerdict {
  /** True when no user/message record carried the command text. */
  readonly ok: boolean
  /** How many user/message records were scanned. */
  readonly checked: number
  /** The offending records, each with a truncated excerpt of its text. */
  readonly offenders: ModelEchoOffender[]
  /** The one sentence explaining what a non-empty `offenders` list proves. */
  readonly failureMode: string
}

/**
 * The surface plan. `source: "pane"` is proven by the captured tmux pane;
 * `source: "store"` is proven by the HARNESS's own session records
 * (`command/run` + `command/done`), cross-checked against the step's pane. Localized host copy is
 * accepted by every pane pattern, and a store row additionally requires the structural
 * `command/run` + correlated `command/done` pair (see {@link StoreProof}), so no row can pass on a
 * printed string alone.
 */
export const SURFACES: readonly SurfaceSpec[] = [
  { surface: "tuiStatus", step: "boot", source: "pane", keys: [], waitMs: 0, pattern: STATUS_LINE, label: "keyed status line above the prompt (English or Chinese rendering)" },
  {
    surface: "tuiCommandTrees", step: "cmd-tree", source: "pane", keys: ["/mpd "], waitMs: 5000,
    // The completion popup CONSUMES the first Backspace (it closes on it), so the original five
    // backspaces left a stray `/` in the prompt; the next step then typed `//mpd workmates`, which the
    // harness adjudicated as CHAT TEXT and handed to the model (measured 2026-10-06: the run's store
    // carried `user/message "//mpd workmates"` plus the model's own `Mpd_workmate_list` tool call, and
    // a `//`-prefixed line runs NO command). One Escape first, then a generous over-erase, leaves the
    // prompt empty; extra backspaces on an empty prompt are inert.
    post: ["Escape", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace", "BSpace"],
    pattern: /列出 workmate|List the durable workmate library|打开 MPD 面板|Open the mpd board scene/,
    label: "/mpd completion advertised the tree child description",
  },
  {
    surface: "commands", step: "cmd-workmates", source: "store", keys: ["/mpd workmates", "Enter"], waitMs: 7000,
    // The Chinese rendering uses the FULL-WIDTH parenthesis `（`, so the original ASCII-only
    // `/mpd workmates \(/` could not match the printed line this host writes.
    pattern: /mpd workmates[（(]/,
    // The harness ran OUR command through its registry and the handler returned success. Measured
    // 2026-10-06 on 0.13.0: `/mpd workmates` records `command/run {name:"mpd",args:" workmates"}` plus
    // `command/done {kind:"success",text:"mpd workmates（1）：qa-tui-probe"}` — the text IS recorded for
    // a command that RETURNS text (only a scene-opening action like `/mpd board` returns bare success).
    storeProof: { name: "mpd", args: /workmates/, doneKind: "success" },
    label: "the command really ran (harness command/run + success completion) and printed its localized line",
  },
  {
    // THE PANEL SURFACE (frozen R2/R3). `/mpd panel` prints `panel.opened` ONLY when the seam is
    // bound, the host's own `list()` read-back produced an id and `open(id)` returned true; the two
    // other outcomes print their own sentences. A host without the seam (pre-0.13.0) therefore reddens
    // here rather than passing quietly — see the lane's recorded bound about the panel BODY.
    //
    // POSITION: this step sits with the OTHER plain-chat command steps, BEFORE `/settings` and the
    // managed dialog. The host hands the keyboard to any overlay, so a command typed after the dialog
    // arm reaches the dialog rather than the prompt — measured 2026-10-06: with this row last, the run
    // recorded only the `board` command and no `panel` invocation at all.
    surface: "tuiPanels", step: "cmd-panel", source: "store", keys: ["/mpd panel", "Enter"], waitMs: 7000,
    pattern: PANEL_OPENED,
    storeProof: { name: "mpd", args: /panel/, doneKind: "success" },
    label: "the sidebar panel seam bound, the host list() read-back yielded an id, and the host ACCEPTED the open",
  },
  // THE SETTLE THAT GIVES THE COMPOSER BACK (the `pre` half of the step). `/mpd panel` opens the host
  // SIDEBAR and the sidebar then HOLDS the keyboard, so every step after it changed NOTHING on screen:
  // MEASURED — `cmd-panel`, `scene`, `renderer`, `settings` and `dialog-pre` were BYTE-IDENTICAL, md5
  // `fe9c119b28a9d3751fce395212284727` (`evidence/tui/lanes/2026-10-08T03-04-51.787Z/`). `Ctrl+B` is the
  // host's OWN `sidePanel` action, so ONE settle here returns the keyboard to the composer for this step
  // and for every step after it.
  {
    surface: "tuiScenes", step: "scene", source: "pane", pre: ["C-b"], keys: ["/mpd board", "Enter"], waitMs: 8000,
    pattern: /MPD board/, label: "the board scene opened (title rendered)",
  },
  { surface: "tuiRenderers", step: "renderer", source: "pane", keys: ["Escape"], waitMs: 6000, pattern: /board opened via/, label: "the log-only event rendered a transcript row" },
  {
    surface: "tuiSettingsSections", step: "settings", source: "pane", keys: ["/settings", "Enter"], waitMs: 8000,
    pattern: /MPD 插件包|MPD bundle/,
    allPatterns: [
      /MPD 插件包|MPD bundle/,
      /a save writes <workspace>\/\.mpd\/mpd\.jsonc for the live session workspace\(s\)/,
      /takes effect for the mpd plugins after a restart/,
      /never lost/,
    ],
    label: "the /settings section rendered WITH its bridge+restart+never-lost disclosure (pane widened to 320 so the hint is not cut)",
  },
  { surface: "tuiDialogs", step: "dialog", source: "pane", pre: ["Escape"], keys: ["M-w"], waitMs: 8000, pattern: /mpd workmates/, label: "the managed select dialog appeared" },
]

/**
 * The assertion engine. Pure: it takes captured panes and returns per-surface
 * results, so the negative control can re-run it on the same text with an extra
 * impossible expectation.
 * @param panes The captured panes, in drive order; the last one is the fallback text.
 * @param surfaces The planned rows to judge, in order.
 * @param extra Additional rows injected by a negative control, judged after the plan.
 * @param store The command-store slice a `source: "store"` row is proven from.
 * @returns The overall verdict plus one result per judged row.
 */
export function evaluateSurfaces(panes: readonly PaneText[], surfaces: readonly SurfaceSpec[] = SURFACES, extra: readonly SurfaceRow[] = [], store?: CommandStoreSlice): SurfaceEvaluation {
  // The pane text of each step, keyed by step name, for the pane-backed rows.
  const byName = new Map(panes.map((pane) => [pane.name, pane.text]))
  // One result per judged row, in plan order followed by the extras.
  const results: SurfaceResult[] = []
  for (const surface of [...surfaces, ...extra]) {
    /** The step's own pane text; also the SECOND source a store row is judged against. */
    const paneText = byName.get(surface.step) ?? panes.at(-1)?.text ?? ""
    /** The store half of the judged text: every `command/done` record's rendered text. */
    const storeText = (store?.dones ?? []).map((done) => String(done.text ?? "")).join("\n")
    // A store row is judged on BOTH sources — the harness's own records and the step's pane — because
    // either one can carry the printed line and neither alone may be assumed present on every harness.
    const text = surface.source === "store" ? storeText + "\n" + paneText : paneText
    // A surface may require SEVERAL patterns in the same capture (e.g. the settings
    // section must show its title AND its bridge+restart disclosure). Every one must match.
    const required = surface.allPatterns ?? [surface.pattern].filter((entry) => entry !== undefined)
    // The required patterns this capture did not match, stringified for the report.
    const missing = required.filter((entry) => !entry.test(text)).map((entry) => String(entry))
    // The structural store proof a store row additionally declares; absent for every pane row.
    const missingProof = surface.source !== "store" || surface.storeProof === undefined || store === undefined
      ? []
      : storeProofFindings(store, surface.storeProof, surface.step)
    // A row renders only when it required at least one pattern, matched every one, and satisfied its proof.
    const rendered = required.length > 0 && missing.length === 0 && missingProof.length === 0
    results.push({
      ...surface,
      pattern: String(surface.pattern),
      requiredPatterns: required.map((entry) => String(entry)),
      missingPatterns: missing,
      missingProof,
      rendered,
      sourceChars: storeText.length,
      paneChars: paneText.length,
      judgedChars: text.length,
    })
  }
  return { ok: results.every((entry) => entry.rendered), results }
}

/**
 * Judge one structural store proof against THIS run's command records.
 *
 * The pair is what makes a store row non-vacuous: `command/run` proves the harness's registry received
 * OUR command with the expected arguments, and the `command/done` correlated by `commandId` proves the
 * handler returned the expected `kind` (an `error` kind reddens). A done record without its run, or a
 * run without its done, is a finding rather than a pass.
 * @param store The command records of this run.
 * @param proof The structural expectation the row declares.
 * @param step The step name, kept so the finding names the capture it belongs to.
 * @returns One sentence per unmet half; an empty list means the pair held.
 */
function storeProofFindings(store: CommandStoreSlice, proof: StoreProof, step: string): string[] {
  /** The findings, in check order. */
  const findings: string[] = []
  /** The invocations matching the declared name and argument spelling. */
  const runs = (store.runs ?? []).filter((run) => String(run.name ?? "") === proof.name && proof.args.test(String(run.args ?? "")))
  if (runs.length === 0) {
    findings.push("store-proof[" + step + "]: no command/run with name=" + proof.name + " args=" + String(proof.args))
    return findings
  }
  /** Every completion id this run recorded, so the correlation is checked rather than assumed. */
  const doneIds = new Set((store.dones ?? []).map((done) => String((done as { commandId?: unknown }).commandId ?? "")))
  /** The invocation whose completion this row reads; the LAST match, i.e. this run's own press. */
  const run = runs.at(-1)
  /** The id correlating that invocation with its completion. */
  const id = String(run?.commandId ?? "")
  if (id.length === 0 || !doneIds.has(id)) {
    findings.push("store-proof[" + step + "]: command/run " + proof.name + " has no correlating command/done (commandId=" + (id === "" ? "(absent)" : id) + ")")
    return findings
  }
  /** The completion the harness recorded for that invocation. */
  const done = (store.dones ?? []).find((entry) => String((entry as { commandId?: unknown }).commandId ?? "") === id) as { kind?: unknown } | undefined
  if (String(done?.kind ?? "") !== proof.doneKind) {
    findings.push("store-proof[" + step + "]: command/done kind=" + String(done?.kind) + " (expected " + proof.doneKind + ")")
  }
  return findings
}

/**
 * The `/mpd` invocation must be handled by the plugin, never forwarded to the model:
 * a `user/message` record carrying the command text would mean the harness treated
 * the slash command as chat input. Only `command/run` + `command/done` may exist.
 *
 * The check is SCOPED to the sessions THIS run created. A warm sandbox root legitimately carries
 * earlier runs' stores, so an unscoped scan both fails on a neighbour's record and — when the store
 * reader finds nothing at all — passes with `checked: 0`, which is a vacuous pass rather than a proof.
 * @param userMessages The decoded `user/message` records of the sandbox store.
 * @param commandTexts The needles that must never appear in a user message.
 * @param only The session ids this run created; `undefined` judges every supplied record.
 * @returns The verdict, the scanned count and every offending record.
 */
export function findModelEcho(userMessages: readonly UserMessageRecord[], commandTexts: readonly string[] = ["/mpd"], only?: ReadonlySet<string>): ModelEchoVerdict {
  /** The records in scope: this run's own sessions when the caller named them. */
  const scoped = only === undefined ? userMessages : userMessages.filter((message) => only.has(message.sessionId))
  // The messages that carried the command text instead of being adjudicated as a command.
  const offenders = scoped.filter((message) => commandTexts.some((needle) => String(message.text ?? "").includes(needle)))
  return {
    ok: offenders.length === 0,
    checked: scoped.length,
    offenders: offenders.map((message) => ({ sessionId: message.sessionId, seq: message.seq, excerpt: String(message.text ?? "").slice(0, 120) })),
    failureMode: "a user/message record carrying the command text proves the harness sent the slash command to the model (the plugin did not handle it)",
  }
}

/** What the plugin's `/mpd panel` sentence proves about the sidebar-panel registration. */
export interface PanelRegistrationVerdict {
  /** True when this run recorded a `/mpd panel` success whose text is the panel-OPENED sentence. */
  readonly ok: boolean
  /** The host panel id the sentence named, i.e. what the adapter's `list()` read-back produced. */
  readonly id?: string
  /** The printed sentence as the harness recorded it. */
  readonly text?: string
  /** One sentence naming what the observation proves. */
  readonly reason: string
  /**
   * The measured LIMIT of this proof, carried so no reader mistakes it for a render claim.
   *
   * MEASURED 2026-10-06 on 0.13.0: after `/mpd panel` the host answered `open() === true` (the printed
   * sentence names the id), and the captured 320x50 pane was BYTE-IDENTICAL before and after the open
   * (both captures 3413 characters, equal after trailing-whitespace normalisation): the chat screen's
   * visible area on this host is the splash art plus the prompt, so the panel bar and the panel's own
   * body are NOT in a tmux pane capture. This lane therefore proves REGISTRATION + OPEN, and says so
   * instead of claiming the panel renders.
   */
  readonly bound: string
}

/**
 * Read the sidebar-panel registration out of the harness's own command records.
 * @param store The command records of this run.
 * @returns The verdict, the discovered id and the recorded bound.
 */
export function panelRegistration(store: CommandStoreSlice): PanelRegistrationVerdict {
  /** The sentence a host that OPENED the panel wrote, i.e. the only outcome that proves registration. */
  const opened = (store.dones ?? []).map((done) => String(done.text ?? "")).filter((text) => PANEL_OPENED.test(text))
  /** The id the host's own `list()` read-back produced, read from the sentence's accepted clause. */
  const id = opened.length === 0 ? undefined : PANEL_OPENED_ID.exec(opened.at(-1) ?? "")?.[1]
  /** True when a sentence was printed, it named an id, and nothing about a refusal was printed. */
  const ok = opened.length > 0 && typeof id === "string" && id.length > 0
  return {
    ok,
    id,
    text: opened.at(-1),
    reason: ok
      ? "the host's own list() read-back produced the panel id " + String(id) + " and open() was ACCEPTED for it"
      : "no panel-OPENED sentence reached the store: the seam never bound, no id was discovered, or the host refused the open",
    bound: "the panel's BODY is not observable in a tmux pane capture on this host: the captured pane was "
      + "byte-identical before and after a host-ACCEPTED open, so this lane proves registration + open (and the id), never a render",
  }
}

/**
 * Seed one workmate so `alt+w` reaches the dialog branch instead of the scene fallback.
 * @param root The sandbox root whose `home/.mpd/workmate` library is seeded.
 * @returns Absolute path of the seeded workmate directory.
 */
export function seedWorkmate(root: string): string {
  // The seeded instance directory: the name is what the dialog must list.
  const dir = join(root, "home", ".mpd", "workmate", "qa-tui-probe")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ name: "qa-tui-probe", base: "explorer" }, null, 2) + "\n")
  writeFileSync(join(dir, "note.md"), "QA probe workmate for the tui-panels dialog arm\n")
  return dir
}

/** The reference panes every offline assertion is judged against. */
function fixturePanes(): PaneText[] {
  // NOTE the two store steps: their reference panes carry ONLY the typed command echo. MEASURED
  // 2026-10-06 on 0.13.0 — a command's printed result does NOT appear in the captured pane at all
  // (the chat screen's visible area is the splash plus the prompt), so the harness's own
  // `command/done` record is the witness; modelling the pane as if it showed the line would make the
  // panel mutant below pass on the pane half and hide a real regression.
  return [
    { name: "boot", text: "DEEPSEEK HARNESS\nmpd: team - · plans 1 · workmates 1\n> " },
    { name: "cmd-status", text: "> /mpd workmates\nmpd workmates (2): demo-workmate, qa-tui-probe\n" },
    { name: "cmd-tree", text: "> /mpd \n board      Open the mpd board scene\n status     Print the mpd status line\n workmates  List the durable workmate library\n" },
    { name: "cmd-workmates", text: "> /mpd workmates\n" },
    { name: "cmd-panel", text: "> /mpd panel\n" },
    { name: "scene", text: "MPD board\n team: none\n q/Esc to close\n" },
    { name: "renderer", text: "mpd board\n board opened via command at 2026-09-15T00:00:00.000Z\n" },
    { name: "settings", text: "插件设置\n ╭─ MPD 插件包 (mpd) ─╮\n │ ❯ 行内 diff 上限  20000 │\n  mpd.jsonc hashline.maxDiffChars — a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes effect for the mpd plugins after a restart (this knob is read at plugin mount) the value is never lost: it is stored in the host settings document and the config layer applies it to every workspace immediately — only the file write waits for exactly one live session   Enter\n" },
    { name: "dialog", text: "mpd workmates\n qa-tui-probe\n" },
  ]
}

/**
 * The reference command records: one correlated `command/run` + `command/done` pair per store row.
 * @returns A store slice whose two invocations satisfy the structural proofs of both store rows.
 */
function fixtureStore(): CommandStoreSlice {
  return {
    runs: [
      { sessionId: "s1", commandId: "cmd-1", name: "mpd", args: " workmates" },
      { sessionId: "s1", commandId: "cmd-2", name: "mpd", args: " panel" },
    ],
    dones: [
      { sessionId: "s1", commandId: "cmd-1", kind: "success", text: "mpd workmates（2）：demo-workmate, qa-tui-probe" },
      { sessionId: "s1", commandId: "cmd-2", kind: "success", text: "mpd 侧栏面板：宿主已接受 act1:team；若没有出现面板，请在 /settings → 侧栏里把 act1:team 加入面板列表，并按 Ctrl+B 展开（或开启“启动时展开侧栏”）" },
    ],
  }
}

/** The offline arm: the reference panes pass and every injected defect flips its own check. */
function selfTest(): void {
  // The bound assertion collector: `check` records failures into `problems`.
  const { check, problems } = makeChecks()
  // The reference store: correlated `command/run` + `command/done` pairs, which every store row needs.
  const storeFixture = fixtureStore()
  // The reference evaluation every other arm is compared against.
  const good = evaluateSurfaces(fixturePanes(), SURFACES, [], storeFixture)
  check(good.ok, "the reference panes must satisfy every surface")
  check(good.results.length === SURFACES.length, "one result per surface is required")

  // THE LOCALIZED STATUS ARM. The host paints Chinese, so the SAME reference pane with the plugin's
  // own zh dictionary strings must pass as well; the English-only predicate read that line as missing.
  const zhBoot = fixturePanes().map((pane) => (pane.name === "boot" ? { ...pane, text: "DEEPSEEK HARNESS\nmpd: 团队 - · 计划 0 · workmate 1\n> " } : pane))
  check(evaluateSurfaces(zhBoot, SURFACES, [], storeFixture).results.find((entry) => entry.surface === "tuiStatus")?.rendered === true,
    "the Chinese status line must satisfy the tuiStatus row")
  check(!evaluateSurfaces(fixturePanes().map((pane) => (pane.name === "boot" ? { ...pane, text: "DEEPSEEK HARNESS\n> " } : pane)), SURFACES, [], storeFixture).ok,
    "a NEGATIVE CONTROL failed: a boot pane without the keyed line must fail tuiStatus")

  // The reference panes with the scene capture replaced by text that cannot match.
  const broken = fixturePanes().map((pane) => (pane.name === "scene" ? { ...pane, text: "no scene here" } : pane))
  // The evaluation of that mutant; the scene row must be the one that fails.
  const bad = evaluateSurfaces(broken, SURFACES, [], storeFixture)
  check(!bad.ok, "a NEGATIVE CONTROL failed: a missing scene render must fail the lane")
  check(bad.results.find((entry) => entry.surface === "tuiScenes")?.rendered === false, "the failing surface must be named")

  // The reference panes with the dialog capture emptied, so the dialog row must fail.
  const absentDialog = fixturePanes().map((pane) => (pane.name === "dialog" ? { ...pane, text: "> " } : pane))
  check(!evaluateSurfaces(absentDialog, SURFACES, [], storeFixture).ok, "a NEGATIVE CONTROL failed: an absent dialog must fail the lane")
  check(!evaluateSurfaces(fixturePanes(), SURFACES, [], { dones: [], runs: [] }).ok, "a NEGATIVE CONTROL failed: an empty command store must fail the store rows")

  // THE STRUCTURAL PROOF IS LOAD-BEARING: a store row must redden when the pair is not correlated even
  // though the PRINTED LINE is present, so no row can pass on a string alone.
  const textOnly = { dones: [{ sessionId: "s1", commandId: "cmd-1", kind: "success", text: "mpd workmates（2）：demo-workmate" }], runs: [] }
  /** The same evaluation over a done record with NO matching run: it must redden. */
  const withoutRun = evaluateSurfaces(fixturePanes(), SURFACES, [], textOnly)
  check(!withoutRun.ok, "a NEGATIVE CONTROL failed: a done record with no command/run must fail the store row")
  check(withoutRun.results.find((entry) => entry.surface === "commands")?.missingProof.length === 1, "the missing proof must be reported")
  // A completion that reports a FAILURE kind must redden even with the right text and run.
  const failedKind = { runs: storeFixture.runs, dones: [{ sessionId: "s1", commandId: "cmd-1", kind: "error", text: "mpd workmates（2）：demo-workmate" }, ...storeFixture.dones!.slice(1)] }
  check(!evaluateSurfaces(fixturePanes(), SURFACES, [], failedKind).ok, "a NEGATIVE CONTROL failed: a non-success completion kind must fail the store row")

  // THE PANEL ROW: the reference store proves it, and the two NON-opened outcomes must redden it.
  check(panelRegistration(storeFixture).ok && panelRegistration(storeFixture).id === "act1:team",
    "the reference store must prove the panel registration and yield the discovered id")
  check(!panelRegistration({ runs: storeFixture.runs, dones: [{ sessionId: "s1", commandId: "cmd-2", kind: "success", text: "mpd 侧栏面板：该宿主不提供面板接缝，使用全屏面板" }] }).ok,
    "a NEGATIVE CONTROL failed: the no-seam sentence must NOT satisfy the panel row")
  check(!panelRegistration({ runs: storeFixture.runs, dones: [{ sessionId: "s1", commandId: "cmd-2", kind: "success", text: "mpd 侧栏面板：宿主拒绝了打开请求（act1:team），已改为全屏面板" }] }).ok,
    "a NEGATIVE CONTROL failed: the refused-open sentence must NOT satisfy the panel row")
  // THE MATCHER MUST STILL FAIL ON THE WORDING IT REPLACED, or "the panel opened" could be satisfied by
  // a sentence no build prints: this is the same literal the retired pattern carried.
  check(!panelRegistration({ runs: storeFixture.runs, dones: [{ sessionId: "s1", commandId: "cmd-2", kind: "success", text: "mpd 侧栏面板：已打开（act1:team）" }] }).ok,
    "a NEGATIVE CONTROL failed: the RETIRED `已打开` wording must NOT satisfy the corrected panel row")
  // The panel row is judged through the same engine, so the mutant must flip exactly that row.
  const noPanel = evaluateSurfaces(fixturePanes(), SURFACES, [], { runs: storeFixture.runs, dones: storeFixture.dones!.map((done) => (done.commandId === "cmd-2" ? { ...done, text: "mpd 侧栏面板：该宿主不提供面板接缝，使用全屏面板" } : done)) })
  check(!noPanel.ok && noPanel.results.find((entry) => entry.surface === "tuiPanels")?.rendered === false, "a NEGATIVE CONTROL failed: a host without the seam must fail the panel row by name")

  // The engine re-run with ONLY an expectation that cannot appear; it must go red.
  const control = evaluateSurfaces(fixturePanes(), [], [{ surface: "negative-control", step: "boot", source: "pane", pattern: /MPD-PANELS-CONTROL-CANNOT-APPEAR/, label: "impossible expectation" }], storeFixture)
  check(!control.ok, "the negative control must fail on an expectation that cannot appear")

  // THE MODEL-ECHO SCOPE: a warm root's neighbour record must be out of scope, its OWN record must not.
  const neighbour: UserMessageRecord = { sessionId: "old", seq: 1, text: "/mpd workmates" }
  /** THIS run's own echoed command, spelled with the lane's stray slash, which must be caught. */
  const own: UserMessageRecord = { sessionId: "new", seq: 2, text: "//mpd workmates" }
  check(!findModelEcho([neighbour], ["/mpd"], new Set(["new"])).ok === false && findModelEcho([neighbour], ["/mpd"], new Set(["new"])).checked === 0,
    "a neighbouring session's record must be out of scope for the model-echo check")
  check(!findModelEcho([neighbour, own], ["/mpd"], new Set(["new"])).ok, "a NEGATIVE CONTROL failed: this run's own echoed command must be caught")
  check(findModelEcho([own], ["/mpd"], new Set(["other"])).checked === 0, "an out-of-scope offender must not be counted")

  check(existsSync(join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js")), "the built plugin dist is missing")
  // The skill document that must list this case, or the case is unreachable.
  const skill = join(REPO, "skills", "dsh-qa", "SKILL.md")
  check(existsSync(skill) && readFileSync(skill, "utf8").includes("| tui-panels |"), "the case table does not list tui-panels")
  check(SURFACES.length === 8, "all seven activation-gated seams plus the 0.13.0 panel surface must be exercised")

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: 8 surfaces asserted, negative controls fail as required")
}

/** The live arm: drive the real TUI through every surface and falsify the engine on its own panes. */
function real(): void {
  // The lane's own command line; the sandbox flags and `--control` are read from this slice.
  const argv = process.argv.slice(2)
  // The sandbox root: every path below resolves inside it, never the real home.
  const { root } = parseSandboxArgs(argv, SLUG)
  // This run's evidence directory, created by the shared helper.
  const outDir = laneEvidenceDir(SLUG)
  // The artifact revision measured before the boot touches anything.
  const revisionBefore = artifactRevision()
  // One line per step, joined into `output.log` at the end of the run.
  const log: string[] = []
  // Append one line to the log and echo it with this lane's prefix.
  const say = (line: string): void => { log.push(line); console.log("[" + SLUG + "] " + line) }
  // The sandbox profile's state at gate time; a missing host or bundle degrades to a declared skip.
  const state = profileState(root)
  gateTuiPrereqs(SLUG, tuiPrereqs({ sandboxPresent: () => state.present && state.hasHost && state.hasBundle }))

  // Every command record already in the store, so this run's own records are isolable.
  const baseline = readCommandRecords(root)
  // The command ids that predate this run; anything else was recorded by THIS boot.
  const baselineIds = new Set(baseline.dones.map((done) => done.commandId))
  // The session ids that predate this run: the model-echo check is scoped to the delta, so a warm
  // root's neighbour can neither redden this run nor make it pass with `checked: 0`.
  const baselineSessions = new Set(sandboxSessionIds(root))
  // THE FIXTURE STEP this lane owns (the two file-shaped 0.13.0 gates): the first-run wizard's skip
  // flag and the `mpd` agent preset. A fresh sandbox therefore needs no hand-holding, and without the
  // preset the session runs the host default and every MPD surface would read as absent.
  const homeFixture = provisionTuiHome(root)
  say("dsh-tui home fixture=" + homeFixture.evidence.join(", ") + " preset=" + homeFixture.preset)
  // Absolute path of the workmate library seeded for the dialog arm.
  const seeded = seedWorkmate(root)
  say("seeded workmate library at " + seeded.replace(REPO + "/", ""))

  // `boot` is captured by the helper itself; the rest are driven step by step.
  // The host hands the keyboard to any overlay (settings screen, managed dialog), so a
  // step that must land in the plain chat state sends its own settle keys first.
  // The keystroke plan: one entry per capture the surface assertions read.
  const steps: TuiStep[] = []
  for (const surface of SURFACES.filter((entry) => entry.step !== "boot")) {
    if (Array.isArray(surface.pre) && surface.pre.length > 0) steps.push({ name: surface.step + "-pre", keys: surface.pre, waitMs: 4000 })
    steps.push({ name: surface.step, keys: surface.keys, waitMs: surface.waitMs })
    if (Array.isArray(surface.post) && surface.post.length > 0) steps.push({ name: surface.step + "-post", keys: surface.post, waitMs: 2000 })
  }
  // The full tmux lifecycle of this drive, including every pane capture. The pane is WIDER than the
  // lane's original 220 columns so the `/settings` disclosure hint is not cut off (see PANE_WIDTH).
  const session = runTuiSession({ lane: SLUG, root, outDir, steps, bootWaitMs: 90_000, paneWidth: PANE_WIDTH, paneHeight: PANE_HEIGHT })
  for (const failure of session.failures) say("tmux: " + failure)
  // A replayed incident dialog owns the keyboard, so the helper drops the sandbox's replay state
  // before the boot; naming what it dropped keeps that hygiene visible in this lane's own log.
  if (session.replayStateCleared.length > 0) say("dropped the previous run's watchdog replay state: " + session.replayStateCleared.map((file) => file.replace(REPO + "/", "")).join(", "))

  // Every command record now in the store, filtered below to this run's own.
  const store = readCommandRecords(root)
  // The `/mpd` echo verdict: the plugin must have handled the command, not the model.
  const runSessions = new Set([...sandboxSessionIds(root)].filter((id) => !baselineSessions.has(id)))
  /** The `/mpd` echo verdict over THIS run's sessions: the plugin must handle it, not the model. */
  const modelEcho = findModelEcho(readUserMessages(root), ["/mpd"], runSessions)
  say("model-echo check: runSessions=" + runSessions.size + " checked=" + modelEcho.checked + " offenders=" + modelEcho.offenders.length + " (must be 0)")
  if (!modelEcho.ok) {
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify(modelEcho.offenders).slice(0, 800))
  }
  // This run's own command records, which are the only ones a surface may match.
  const fresh = {
    runs: store.runs.filter((run) => !baselineIds.has(run.commandId)),
    dones: store.dones.filter((done) => !baselineIds.has(done.commandId)),
  }
  // The per-surface evaluation of this run's real captures.
  const evaluation = evaluateSurfaces(session.panes, SURFACES, [], fresh)
  say("harness command records THIS run: " + JSON.stringify(fresh.dones))
  say("surfaces: " + evaluation.results.map((entry) => entry.surface + "=" + (entry.rendered ? "rendered" : "MISSING")).join(" "))
  // The panel-registration read-back, recorded with the id the host's own `list()` produced.
  const panel = panelRegistration(fresh)
  say("panel registration id=" + String(panel.id) + " ok=" + panel.ok)

  // NEGATIVE CONTROL on the REAL panes: an expectation that cannot appear must fail.
  const control = evaluateSurfaces(session.panes, [], [{ surface: "negative-control", step: "boot", source: "pane", pattern: /MPD-PANELS-CONTROL-CANNOT-APPEAR/, label: "impossible expectation on the real pane" }], store)
  // The directory holding the negative control's own evidence.
  const negativeDir = join(outDir, "negative")
  mkdirSync(negativeDir, { recursive: true })
  writeFileSync(join(negativeDir, "control.json"), JSON.stringify({ note: "the lane's own assertion engine, re-run on the REAL captured panes with one impossible expectation", control }, null, 2) + "\n")
  writeFileSync(join(negativeDir, "control.log"), "control.ok=" + control.ok + " (must be false)\n" + JSON.stringify(control.results, null, 2) + "\n")
  say("negative control ok=" + control.ok + " (must be false)")

  // The renderer surface is cross-checked against the SESSION STORE: if the plugin
  // appended its log-only event but the Channel projected no transcript row, the
  // finding is "registered + appended, not projected" rather than "not registered".
  // The plugin's own log-only events in the sandbox store, counted by event type.
  const storeEvents = countSessionEvents(root, BOARD_OPENED_EVENT)
  // The scene capture's text, the pane that reports its transcript row count.
  const scenePane = session.panes.find((pane) => pane.name === "scene")?.text ?? ""
  // The transcript row count the scene itself reported, or `undefined` when it said nothing.
  const sceneTranscriptRows = scenePane.match(/(\d+)\s*transcript row\(s\)/)?.[1]
  say("board-opened events in the sandbox store=" + storeEvents.count + " scene-reported transcript rows=" + String(sceneTranscriptRows))
  // The renderer surface's own cross-check, read from the three RAW observations so the finding is
  // falsifiable and its cause is named: the append (store), the Channel's own row count (the scene's
  // header), and the projection into the pane (the surface row above).
  const rendererSurface = evaluation.results.find((entry) => entry.surface === "tuiRenderers")
  /** The three raw observations behind the renderer verdict, written to the evidence file. */
  const rendererCrossCheck = {
    eventType: BOARD_OPENED_EVENT,
    eventsInSandboxStore: storeEvents.count,
    storeSessions: storeEvents.sessions,
    sceneReportedTranscriptRows: sceneTranscriptRows === undefined ? undefined : Number(sceneTranscriptRows),
    paneRenderedTheRow: rendererSurface?.rendered === true,
    interpretation: storeEvents.count === 0
      ? "no event of this type reached the sandbox store — the plugin's registration gate refused the append"
      : rendererSurface?.rendered === true
        ? "the plugin APPENDED its log-only event and the host PROJECTED it as a transcript row"
        : "the plugin APPENDED its log-only event (proven in the session store) but the host projected NO row: the Channel's own row count and the captured transcript are both empty, so this is a PROJECTION gap, not a registration one",
  }
  say("renderer cross-check: " + rendererCrossCheck.interpretation)

  // The lane verdict: every surface rendered, the control failed, the command never echoed, and the
  // host's own panel read-back named an id it then accepted.
  const ok = evaluation.ok && control.ok === false && modelEcho.ok && panel.ok
  // The artifact revision re-measured after the drive, compared against `revisionBefore`.
  const revisionAfter = artifactRevision()

  // The digest comparison this run records; a change between the two readings invalidates the result.
  const { delta } = writeRevisionFile(outDir, {

    before: revisionBefore,

    after: revisionAfter,

    composition: { sandboxRoot: root.replace(REPO + "/", ""), profile: "dsh-tui" },

  })

  if (delta.changed) {

    console.error("[" + SLUG + "] FAIL: " + delta.reason)

    process.exit(1)

  }

  writeLaneEvidence(outDir, SLUG, {
    ok,
    revision: revisionAfter,
    revisionDelta: delta,
    manifestDigest: manifestDigest(),
    steps: { surfaces: evaluation.results, negativeControl: { ok: control.ok, results: control.results } },
    surfaces: evaluation.results.map((entry) => ({ surface: entry.surface, source: entry.source, rendered: entry.rendered, label: entry.label })),
    commandRecords: { dones: fresh.dones, runs: fresh.runs, baselineCommandIds: [...baselineIds].slice(-6) },
    negativeControl: { expected: "fail", observed: control.ok, artifact: "negative/control.json" },
    noModelEcho: modelEcho,
    panel,
    homeFixture,
    pane: { width: PANE_WIDTH, height: PANE_HEIGHT, why: "widened from 220 so the /settings disclosure hint is not truncated in the pane" },
    rendererCrossCheck,
    sandboxRoot: root,
    sessions: readSessionHeaders(root).length,
  }, log.join("\n"))
  if (!ok) {
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify(evaluation.results.filter((entry) => !entry.rendered)).slice(0, 1500))
    process.exit(1)
  }
  console.log("[" + SLUG + "] PASS: all 7 seam surfaces rendered; negative control failed as required")
}

// Entry guard: importing this lane (e.g. to reuse findModelEcho or the surface table)
// must never start a live run. The self-test and the real lane run only when this file IS
// the process entry point.
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest()
  else real()
}
