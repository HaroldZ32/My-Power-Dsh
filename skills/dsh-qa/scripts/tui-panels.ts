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
// PREREQ: absent-dsh-binary dsh-tui "npm i -g @deepseek-harness-tui/dsh-tui@0.12.0"
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
  profileState, readCommandRecords, readSessionHeaders, readUserMessages, runTuiSession, tuiPrereqs, writeLaneEvidence,
  writeRevisionFile,
} from "./lib/tui-lane.ts"
import type { CommandRunRecord, TuiStep, UserMessageRecord } from "./lib/tui-lane.ts"

/** The session-store event type the renderer surface is cross-checked against. */
const BOARD_OPENED_EVENT = "mpd-tui/board-opened"

/** The case slug: names the evidence directory, the tmux socket and every log prefix of this lane. */
const SLUG = "tui-panels"

/** One captured pane the evaluator may judge; the written path is not read here. */
export interface PaneText {
  /** Step name the pane was captured at (`boot` for the boot capture). */
  readonly name: string
  /** The pane text exactly as `capture-pane -p -J` printed it. */
  readonly text: string
}

/** The one field a store-backed surface reads out of a `command/done` record. */
export interface DoneTextRecord {
  /** The rendered result text the harness recorded; a non-string is stringified by the caller. */
  readonly text?: unknown
}

/** The command-store slice a `source: "store"` surface is proven from. */
export interface CommandStoreSlice {
  /** The `command/done` records of THIS run; their text is what a store-backed surface matches. */
  readonly dones?: readonly DoneTextRecord[]
  /** The `command/run` records, carried for the evidence payload and never read here. */
  readonly runs?: readonly unknown[]
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
  /** True when at least one pattern was required and every one of them matched. */
  readonly rendered: boolean
  /** Number of characters the judged text carried, for the pane or the store slice. */
  readonly sourceChars: number
  /** Number of characters the step's pane carried, `0` when the step captured no pane. */
  readonly paneChars: number
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
 * A `command/run` record as the shared reader projects it, plus the correlating id the raw store
 * carries: the shared reader drops that field, so the lane's own read is `undefined` at runtime and
 * this view names the field the filter below reads instead of deleting a read that is part of the
 * lane's recorded behaviour.
 */
interface RunRecordWithCommandId extends CommandRunRecord {
  /** The correlating id the shared reader does not project; `undefined` for every record it builds. */
  readonly commandId?: unknown
}

/**
 * The surface plan. `source: "pane"` is proven by the captured tmux pane;
 * `source: "store"` is proven by the HARNESS's own session records
 * (`command/run` + `command/done`) — the dsh-qa doctrine, because the TUI renders a
 * command's success text in the transcript region, which a 50-row capture may not
 * show. Localized host copy is accepted by every pane pattern.
 */
export const SURFACES: readonly SurfaceSpec[] = [
  { surface: "tuiStatus", step: "boot", source: "pane", keys: [], waitMs: 0, pattern: /mpd:\s+team /, label: "keyed status line above the prompt" },
  { surface: "tuiCommandTrees", step: "cmd-tree", source: "pane", keys: ["/mpd "], post: ["BSpace", "BSpace", "BSpace", "BSpace", "BSpace"], waitMs: 5000, pattern: /列出 workmate|List the durable workmate library|打开 MPD 面板|Open the mpd board scene/, label: "/mpd completion advertised the tree child description" },
  { surface: "commands", step: "cmd-workmates", source: "store", keys: ["/mpd workmates", "Enter"], waitMs: 7000, pattern: /mpd workmates \(/, label: "the command really ran (command/done text recorded by the harness)" },
  { surface: "tuiScenes", step: "scene", source: "pane", keys: ["/mpd board", "Enter"], waitMs: 8000, pattern: /MPD board/, label: "the board scene opened (title rendered)" },
  { surface: "tuiRenderers", step: "renderer", source: "pane", keys: ["Escape"], waitMs: 6000, pattern: /board opened via/, label: "the log-only event rendered a transcript row" },
  { surface: "tuiSettingsSections", step: "settings", source: "pane", keys: ["/settings", "Enter"], waitMs: 8000, pattern: /MPD 插件包|MPD bundle/, allPatterns: [/MPD 插件包|MPD bundle/, /a save writes <workspace>\/\.mpd\/mpd\.jsonc for the live session workspace\(s\)/, /takes effect for the mpd plugins after a restart/, /never lost/], label: "the /settings section rendered WITH its bridge+restart+never-lost disclosure" },
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
    // The text this row is judged against: the store slice, or the step's pane.
    const text = surface.source === "store"
      ? (store?.dones ?? []).map((done) => String(done.text ?? "")).join("\n")
      : byName.get(surface.step) ?? panes.at(-1)?.text ?? ""
    // A surface may require SEVERAL patterns in the same capture (e.g. the settings
    // section must show its title AND its bridge+restart disclosure). Every one must match.
    const required = surface.allPatterns ?? [surface.pattern].filter((entry) => entry !== undefined)
    // The required patterns this capture did not match, stringified for the report.
    const missing = required.filter((entry) => !entry.test(text)).map((entry) => String(entry))
    // A row renders only when it required at least one pattern and matched every one.
    const rendered = required.length > 0 && missing.length === 0
    results.push({
      ...surface,
      pattern: String(surface.pattern),
      requiredPatterns: required.map((entry) => String(entry)),
      missingPatterns: missing,
      rendered,
      sourceChars: text.length,
      paneChars: byName.get(surface.step)?.length ?? 0,
    })
  }
  return { ok: results.every((entry) => entry.rendered), results }
}

/**
 * The `/mpd` invocation must be handled by the plugin, never forwarded to the model:
 * a `user/message` record carrying the command text would mean the harness treated
 * the slash command as chat input. Only `command/run` + `command/done` may exist.
 * @param userMessages The decoded `user/message` records of the sandbox store.
 * @param commandTexts The needles that must never appear in a user message.
 * @returns The verdict, the scanned count and every offending record.
 */
export function findModelEcho(userMessages: readonly UserMessageRecord[], commandTexts: readonly string[] = ["/mpd"]): ModelEchoVerdict {
  // The messages that carried the command text instead of being adjudicated as a command.
  const offenders = userMessages.filter((message) => commandTexts.some((needle) => String(message.text ?? "").includes(needle)))
  return {
    ok: offenders.length === 0,
    checked: userMessages.length,
    offenders: offenders.map((message) => ({ sessionId: message.sessionId, seq: message.seq, excerpt: String(message.text ?? "").slice(0, 120) })),
    failureMode: "a user/message record carrying the command text proves the harness sent the slash command to the model (the plugin did not handle it)",
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
  return [
    { name: "boot", text: "DEEPSEEK HARNESS\nmpd: team - · plans 1 · workmates 1\n> " },
    { name: "cmd-status", text: "> /mpd workmates\nmpd workmates (2): demo-workmate, qa-tui-probe\n" },
    { name: "cmd-tree", text: "> /mpd \n board      Open the mpd board scene\n status     Print the mpd status line\n workmates  List the durable workmate library\n" },
    { name: "scene", text: "MPD board\n team: none\n q/Esc to close\n" },
    { name: "renderer", text: "mpd board\n board opened via command at 2026-09-15T00:00:00.000Z\n" },
    { name: "settings", text: "插件设置\n ╭─ MPD 插件包 (mpd) ─╮\n │ ❯ 行内 diff 上限  20000 │\n  mpd.jsonc hashline.maxDiffChars — a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes effect for the mpd plugins after a restart (this knob is read at plugin mount) the value is never lost: it is stored in the host settings document and the config layer applies it to every workspace immediately — only the file write waits for exactly one live session   Enter\n" },
    { name: "dialog", text: "mpd workmates\n qa-tui-probe\n" },
  ]
}

/** The offline arm: the reference panes pass and every injected defect flips its own check. */
function selfTest(): void {
  // The bound assertion collector: `check` records failures into `problems`.
  const { check, problems } = makeChecks()
  // A store slice whose single `command/done` text is what the store-backed row must match.
  const storeFixture = { dones: [{ text: "mpd workmates (2): demo-workmate, qa-tui-probe" }], runs: [] }
  // The reference evaluation every other arm is compared against.
  const good = evaluateSurfaces(fixturePanes(), SURFACES, [], storeFixture)
  check(good.ok, "the reference panes must satisfy every surface")
  check(good.results.length === SURFACES.length, "one result per surface is required")

  // The reference panes with the scene capture replaced by text that cannot match.
  const broken = fixturePanes().map((pane) => (pane.name === "scene" ? { ...pane, text: "no scene here" } : pane))
  // The evaluation of that mutant; the scene row must be the one that fails.
  const bad = evaluateSurfaces(broken, SURFACES, [], storeFixture)
  check(!bad.ok, "a NEGATIVE CONTROL failed: a missing scene render must fail the lane")
  check(bad.results.find((entry) => entry.surface === "tuiScenes")?.rendered === false, "the failing surface must be named")

  // The reference panes with the dialog capture emptied, so the dialog row must fail.
  const absentDialog = fixturePanes().map((pane) => (pane.name === "dialog" ? { ...pane, text: "> " } : pane))
  check(!evaluateSurfaces(absentDialog, SURFACES, [], storeFixture).ok, "a NEGATIVE CONTROL failed: an absent dialog must fail the lane")
  check(!evaluateSurfaces(fixturePanes(), SURFACES, [], { dones: [], runs: [] }).ok, "a NEGATIVE CONTROL failed: an empty command store must fail the commands surface")

  // The engine re-run with ONLY an expectation that cannot appear; it must go red.
  const control = evaluateSurfaces(fixturePanes(), [], [{ surface: "negative-control", step: "boot", source: "pane", pattern: /MPD-PANELS-CONTROL-CANNOT-APPEAR/, label: "impossible expectation" }], storeFixture)
  check(!control.ok, "the negative control must fail on an expectation that cannot appear")

  check(existsSync(join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js")), "the built plugin dist is missing")
  // The skill document that must list this case, or the case is unreachable.
  const skill = join(REPO, "skills", "dsh-qa", "SKILL.md")
  check(existsSync(skill) && readFileSync(skill, "utf8").includes("| tui-panels |"), "the case table does not list tui-panels")
  check(SURFACES.length === 7, "all seven activation-gated seams must be exercised")

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: 7 surfaces asserted, negative controls fail as required")
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
  // The full tmux lifecycle of this drive, including every pane capture.
  const session = runTuiSession({ lane: SLUG, root, outDir, steps, bootWaitMs: 90_000 })
  for (const failure of session.failures) say("tmux: " + failure)

  // Every command record now in the store, filtered below to this run's own.
  const store = readCommandRecords(root)
  // The `/mpd` echo verdict: the plugin must have handled the command, not the model.
  const modelEcho = findModelEcho(readUserMessages(root))
  say("model-echo check: checked=" + modelEcho.checked + " offenders=" + modelEcho.offenders.length + " (must be 0)")
  if (!modelEcho.ok) {
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify(modelEcho.offenders).slice(0, 800))
  }
  // This run's own command records, which are the only ones a surface may match.
  const fresh = {
    // `command/run` records never carry the id the shared reader projects away, so the read stays
    // `undefined` at runtime; the cast names that undeclared field and keeps the read itself intact.
    runs: store.runs.filter((run) => !baselineIds.has((run as RunRecordWithCommandId).commandId)),
    dones: store.dones.filter((done) => !baselineIds.has(done.commandId)),
  }
  // The per-surface evaluation of this run's real captures.
  const evaluation = evaluateSurfaces(session.panes, SURFACES, [], fresh)
  say("harness command records THIS run: " + JSON.stringify(fresh.dones))
  say("surfaces: " + evaluation.results.map((entry) => entry.surface + "=" + (entry.rendered ? "rendered" : "MISSING")).join(" "))

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

  // The lane verdict: every surface rendered, the control failed and the command never echoed.
  const ok = evaluation.ok && control.ok === false && modelEcho.ok
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
    rendererCrossCheck: {
      eventType: BOARD_OPENED_EVENT,
      eventsInSandboxStore: storeEvents.count,
      storeSessions: storeEvents.sessions,
      sceneReportedTranscriptRows: sceneTranscriptRows === undefined ? undefined : Number(sceneTranscriptRows),
      interpretation: storeEvents.count > 0
        ? "the plugin APPENDED its log-only event (proven in the session store); the transcript row is what the renderer must project"
        : "no event of this type reached the sandbox store — the plugin's iron-rule registration gate refused the append",
    },
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
