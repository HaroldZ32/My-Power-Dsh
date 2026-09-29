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
// PREREQ: absent-dsh-binary dsh-tui "npm i -g @deepseek-harness-tui/dsh-tui@0.10.1"
// PREREQ: absent-runtime tmux "install tmux; the TUI requires a real TTY"
// PREREQ: absent-fixture tui profile in the sandbox root "bun skills/dsh-qa/scripts/tui-mount.mjs --sandbox-root <root> --install"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-panels.mjs --self-test
//   bun skills/dsh-qa/scripts/tui-panels.mjs [--sandbox-root <dir>] [--control]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,<step>.pane.txt,negative/}
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  REPO, artifactRevision, countSessionEvents, gateTuiPrereqs, laneEvidenceDir, makeChecks, manifestDigest, parseSandboxArgs,
  profileState, readCommandRecords, readSessionHeaders, readUserMessages, runTuiSession, tuiPrereqs, writeLaneEvidence,
  writeRevisionFile,
} from "./lib/tui-lane.ts"

const BOARD_OPENED_EVENT = "mpd-tui/board-opened"

const SLUG = "tui-panels"

/**
 * The surface plan. `source: "pane"` is proven by the captured tmux pane;
 * `source: "store"` is proven by the HARNESS's own session records
 * (`command/run` + `command/done`) — the dsh-qa doctrine, because the TUI renders a
 * command's success text in the transcript region, which a 50-row capture may not
 * show. Localized host copy is accepted by every pane pattern.
 */
export const SURFACES = [
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
 */
export function evaluateSurfaces(panes, surfaces = SURFACES, extra = [], store) {
  const byName = new Map(panes.map((pane) => [pane.name, pane.text]))
  const results = []
  for (const surface of [...surfaces, ...extra]) {
    const text = surface.source === "store"
      ? (store?.dones ?? []).map((done) => String(done.text ?? "")).join("\n")
      : byName.get(surface.step) ?? panes.at(-1)?.text ?? ""
    // A surface may require SEVERAL patterns in the same capture (e.g. the settings
    // section must show its title AND its bridge+restart disclosure). Every one must match.
    const required = surface.allPatterns ?? [surface.pattern].filter((entry) => entry !== undefined)
    const missing = required.filter((entry) => !entry.test(text)).map((entry) => String(entry))
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
 */
export function findModelEcho(userMessages, commandTexts = ["/mpd"]) {
  const offenders = userMessages.filter((message) => commandTexts.some((needle) => String(message.text ?? "").includes(needle)))
  return {
    ok: offenders.length === 0,
    checked: userMessages.length,
    offenders: offenders.map((message) => ({ sessionId: message.sessionId, seq: message.seq, excerpt: String(message.text ?? "").slice(0, 120) })),
    failureMode: "a user/message record carrying the command text proves the harness sent the slash command to the model (the plugin did not handle it)",
  }
}

/** Seed one workmate so `alt+w` reaches the dialog branch instead of the scene fallback. */
export function seedWorkmate(root) {
  const dir = join(root, "home", ".mpd", "workmate", "qa-tui-probe")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ name: "qa-tui-probe", base: "explorer" }, null, 2) + "\n")
  writeFileSync(join(dir, "note.md"), "QA probe workmate for the tui-panels dialog arm\n")
  return dir
}

function fixturePanes() {
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

function selfTest() {
  const { check, problems } = makeChecks()
  const storeFixture = { dones: [{ text: "mpd workmates (2): demo-workmate, qa-tui-probe" }], runs: [] }
  const good = evaluateSurfaces(fixturePanes(), SURFACES, [], storeFixture)
  check(good.ok, "the reference panes must satisfy every surface")
  check(good.results.length === SURFACES.length, "one result per surface is required")

  const broken = fixturePanes().map((pane) => (pane.name === "scene" ? { ...pane, text: "no scene here" } : pane))
  const bad = evaluateSurfaces(broken, SURFACES, [], storeFixture)
  check(!bad.ok, "a NEGATIVE CONTROL failed: a missing scene render must fail the lane")
  check(bad.results.find((entry) => entry.surface === "tuiScenes")?.rendered === false, "the failing surface must be named")

  const absentDialog = fixturePanes().map((pane) => (pane.name === "dialog" ? { ...pane, text: "> " } : pane))
  check(!evaluateSurfaces(absentDialog, SURFACES, [], storeFixture).ok, "a NEGATIVE CONTROL failed: an absent dialog must fail the lane")
  check(!evaluateSurfaces(fixturePanes(), SURFACES, [], { dones: [], runs: [] }).ok, "a NEGATIVE CONTROL failed: an empty command store must fail the commands surface")

  const control = evaluateSurfaces(fixturePanes(), [], [{ surface: "negative-control", step: "boot", source: "pane", pattern: /MPD-PANELS-CONTROL-CANNOT-APPEAR/, label: "impossible expectation" }], storeFixture)
  check(!control.ok, "the negative control must fail on an expectation that cannot appear")

  check(existsSync(join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js")), "the built plugin dist is missing")
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

function real() {
  const argv = process.argv.slice(2)
  const { root } = parseSandboxArgs(argv, SLUG)
  const outDir = laneEvidenceDir(SLUG)
  const revisionBefore = artifactRevision()
  const log = []
  const say = (line) => { log.push(line); console.log("[" + SLUG + "] " + line) }
  const state = profileState(root)
  gateTuiPrereqs(SLUG, tuiPrereqs({ sandboxPresent: () => state.present && state.hasHost && state.hasBundle }))

  const baseline = readCommandRecords(root)
  const baselineIds = new Set(baseline.dones.map((done) => done.commandId))
  const seeded = seedWorkmate(root)
  say("seeded workmate library at " + seeded.replace(REPO + "/", ""))

  // `boot` is captured by the helper itself; the rest are driven step by step.
  // The host hands the keyboard to any overlay (settings screen, managed dialog), so a
  // step that must land in the plain chat state sends its own settle keys first.
  const steps = []
  for (const surface of SURFACES.filter((entry) => entry.step !== "boot")) {
    if (Array.isArray(surface.pre) && surface.pre.length > 0) steps.push({ name: surface.step + "-pre", keys: surface.pre, waitMs: 4000 })
    steps.push({ name: surface.step, keys: surface.keys, waitMs: surface.waitMs })
    if (Array.isArray(surface.post) && surface.post.length > 0) steps.push({ name: surface.step + "-post", keys: surface.post, waitMs: 2000 })
  }
  const session = runTuiSession({ lane: SLUG, root, outDir, steps, bootWaitMs: 90_000 })
  for (const failure of session.failures) say("tmux: " + failure)

  const store = readCommandRecords(root)
  const modelEcho = findModelEcho(readUserMessages(root))
  say("model-echo check: checked=" + modelEcho.checked + " offenders=" + modelEcho.offenders.length + " (must be 0)")
  if (!modelEcho.ok) {
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify(modelEcho.offenders).slice(0, 800))
  }
  const fresh = {
    runs: store.runs.filter((run) => !baselineIds.has(run.commandId)),
    dones: store.dones.filter((done) => !baselineIds.has(done.commandId)),
  }
  const evaluation = evaluateSurfaces(session.panes, SURFACES, [], fresh)
  say("harness command records THIS run: " + JSON.stringify(fresh.dones))
  say("surfaces: " + evaluation.results.map((entry) => entry.surface + "=" + (entry.rendered ? "rendered" : "MISSING")).join(" "))

  // NEGATIVE CONTROL on the REAL panes: an expectation that cannot appear must fail.
  const control = evaluateSurfaces(session.panes, [], [{ surface: "negative-control", step: "boot", source: "pane", pattern: /MPD-PANELS-CONTROL-CANNOT-APPEAR/, label: "impossible expectation on the real pane" }], store)
  const negativeDir = join(outDir, "negative")
  mkdirSync(negativeDir, { recursive: true })
  writeFileSync(join(negativeDir, "control.json"), JSON.stringify({ note: "the lane's own assertion engine, re-run on the REAL captured panes with one impossible expectation", control }, null, 2) + "\n")
  writeFileSync(join(negativeDir, "control.log"), "control.ok=" + control.ok + " (must be false)\n" + JSON.stringify(control.results, null, 2) + "\n")
  say("negative control ok=" + control.ok + " (must be false)")

  // The renderer surface is cross-checked against the SESSION STORE: if the plugin
  // appended its log-only event but the Channel projected no transcript row, the
  // finding is "registered + appended, not projected" rather than "not registered".
  const storeEvents = countSessionEvents(root, BOARD_OPENED_EVENT)
  const scenePane = session.panes.find((pane) => pane.name === "scene")?.text ?? ""
  const sceneTranscriptRows = scenePane.match(/(\d+)\s*transcript row\(s\)/)?.[1]
  say("board-opened events in the sandbox store=" + storeEvents.count + " scene-reported transcript rows=" + String(sceneTranscriptRows))

  const ok = evaluation.ok && control.ok === false && modelEcho.ok
  const revisionAfter = artifactRevision()

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
