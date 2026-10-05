#!/usr/bin/env bun
// Case tui-deps-ctrla: prove the dependency view through a REAL TTY, from the captured pane only.
//
// What it proves (never from prose — always from a pane the host itself painted):
//   (a) THE ARROW IS DRAWN. With a two-task team in the sandbox workspace (t2 blocked by t1) the
//       merged panel renders the dependency graph, and the drawing carries a directional arrow CELL:
//       a terminal row whose whole visible content is connectors and arrowheads. That shape is what
//       makes the assertion falsifiable — the legend row always carries words, so it can never
//       satisfy the arrow-cell pattern, and an arrow drawn nowhere fails the arm.
//   (b) THE PANEL RENDERS AT ALL (baseline, MPD's own key): `alt+a` opens the merged panel, so a
//       broken drawing or panel is diagnosed without blaming the key hook. This step ALSO arms the
//       take-over, because the host only hands a plugin its live input kit on a SCENE render — the
//       documented one-time bootstrap of the Ctrl+A hook — so the arms run in the order a user
//       actually meets them.
//   (c) CTRL+A OPENS THE MPD PANEL. With that team present, Ctrl+A lands on the same panel.
//   (d) THE TAKEOVER IS SCOPED (the negative control). The SAME boot, the SAME key, after the team
//       record is removed: Ctrl+A must open the HOST dashboard again. An unconditional takeover
//       fails this arm, and a takeover that never happens fails (c).
//   (e) IT DOES NOT FIRE OVER AN EXCLUSIVE HOST SURFACE. With `/settings` open, Ctrl+A must leave the
//       settings screen untouched — the hook component is unmounted there, and this arm proves the
//       property on a real pane instead of inferring it from the host's branch order.
//   (f) THE CONTACT BOUND TO THE HOST COPY THIS LANE LAUNCHED. The adapter's own file sink is read and
//       its `host contact bound: <root>` line must name the SANDBOX PROFILE's dsh-tui — "a panel
//       opened" alone cannot tell the running host's module from a stale sibling install.
//
// The arms are read from ONE lifecycle, so they cannot disagree about which revision ran.
//
// PREREQ: absent-dsh-binary dsh-tui "npm i -g @deepseek-harness-tui/dsh-tui@0.12.0"
// PREREQ: absent-runtime tmux "install tmux; the TUI requires a real TTY"
// PREREQ: absent-fixture tui profile in the sandbox root "bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root <root> --install"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-deps-ctrla.ts --self-test
//   bun skills/dsh-qa/scripts/tui-deps-ctrla.ts [--sandbox-root <dir>] [--fresh]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,*.pane.txt,negative/control.json}
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  REPO, artifactRevision, gateTuiPrereqs, laneEvidenceDir, makeChecks, parseSandboxArgs, profileState, revisionDelta,
  runTuiSession, tuiPrereqs, writeLaneEvidence, writeRevisionFile,
} from "./lib/tui-lane.ts"
import type { TuiStep } from "./lib/tui-lane.ts"
import { stagedRecord, writeTeamFixture } from "./tui-team-surface.ts"

/** The case slug: names the evidence directory, the private tmux socket and every log prefix. */
export const SLUG: string = "tui-deps-ctrla"

/** The merged panel's own scene title, printed by the panel's first row (frozen by the scene contract). */
export const PANEL_TITLE: RegExp = /MPD subagents \+ team/

/** The host's own dashboard title, in either language the host ships (`i18n.js`). */
export const HOST_TITLE: RegExp = /子代理面板|Subagent Dashboard/

/** The header both MPD scenes print directly above the drawing. */
export const DAG_HEADER: RegExp = /task dependency graph/

/** The host settings screen's own frame, which lists this bundle's section (either language). */
export const SETTINGS_SCREEN: RegExp = /MPD 插件包|MPD bundle/

/**
 * The adapter's ONE host-contact line, as its file sink writes it.
 *
 * This is the artifact-side half of the proof: the take-over only works against the host module the
 * running TUI itself imported, so the lane requires the bound root to be the SANDBOX PROFILE's own
 * copy — a lane that only proved "a panel opened" could not tell the right copy from a stale one.
 */
export const HOST_CONTACT_LINE: RegExp = /\[mpd-tui-adapter\] host contact bound: (\S+) \(lib\/types\/ui\.js\)/

/**
 * THE ARROW CELL: one terminal row whose visible content is ONLY vertical connectors and arrowheads.
 *
 * This is the falsifier for clause (a): the legend row spells the arrow out in words, so it cannot
 * match an anchored, words-free row, while an arrow actually drawn into the dependent's entry cell
 * produces exactly that row. `m` keeps the match per line, which is what a pane capture gives us.
 */
export const ARROW_CELL: RegExp = /^[\s│]*▼[\s▼│]*$/m

/** One captured pane the assertions are judged against. */
export interface PaneText {
  /** Step name the pane was captured at (`boot` for the boot capture). */
  readonly name: string
  /** The pane text exactly as `capture-pane -p -J` printed it. */
  readonly text: string
}

/** One arm: what must be present, what must appear on its own line, and what must be absent. */
export interface PaneAssertion {
  /** The capture this arm judges; also the evidence file name. */
  readonly capture: string
  /** Human-readable statement of what a pass proves, recorded per result. */
  readonly label: string
  /** Patterns that must each match somewhere in the capture. */
  readonly all?: readonly RegExp[]
  /** Patterns that must each match at least one LINE of the capture. */
  readonly lines?: readonly RegExp[]
  /** Patterns that must NOT match anywhere: the other arm's fingerprint lives here. */
  readonly none?: readonly RegExp[]
}

/** What one arm actually saw. */
export interface PaneVerdict {
  /** The capture this arm judged. */
  readonly capture: string
  /** The arm's own statement of what a pass proves. */
  readonly label: string
  /** The required patterns that matched nowhere, stringified; empty means the arm passed. */
  readonly missing: readonly string[]
  /** The required line patterns that matched no single line, stringified. */
  readonly missingLines: readonly string[]
  /** The forbidden patterns that DID match, stringified; empty means nothing forbidden appeared. */
  readonly forbidden: readonly string[]
  /** Characters the judged capture carried, so an empty pane is visible in the evidence. */
  readonly chars: number
  /** True when every requirement held and nothing forbidden appeared. */
  readonly ok: boolean
}

/** The outcome of one evaluation pass. */
export interface PaneEvaluation {
  /** True when every arm passed. */
  readonly ok: boolean
  /** One verdict per arm, in plan order. */
  readonly results: readonly PaneVerdict[]
}

/**
 * Judge one set of captures against one set of arms. Pure: the pane text is the only input, so the
 * self-test can falsify the engine on synthetic panes without a terminal.
 * @param panes - the captures, by step name.
 * @param arms - the assertions to apply.
 * @returns the evaluation, with one verdict per arm.
 */
export function evaluatePanes(panes: readonly PaneText[], arms: readonly PaneAssertion[]): PaneEvaluation {
  /** The verdicts, in plan order. */
  const results: PaneVerdict[] = []
  for (const arm of arms) {
    /** The capture this arm judges; an absent capture is judged as empty text. */
    const text = panes.find((pane) => pane.name === arm.capture)?.text ?? ""
    /** The lines of that capture, for the anchored patterns. */
    const lines = text.split("\n")
    /** The required patterns that matched nothing. */
    const missing = (arm.all ?? []).filter((pattern) => !pattern.test(text)).map(String)
    /** The anchored patterns that matched no line. */
    const missingLines = (arm.lines ?? []).filter((pattern) => !lines.some((line) => pattern.test(line))).map(String)
    /** The forbidden patterns that DID match. */
    const forbidden = (arm.none ?? []).filter((pattern) => pattern.test(text)).map(String)
    results.push({
      capture: arm.capture,
      label: arm.label,
      missing,
      missingLines,
      forbidden,
      chars: text.length,
      ok: missing.length === 0 && missingLines.length === 0 && forbidden.length === 0,
    })
  }
  return { ok: results.every((verdict) => verdict.ok), results }
}

/**
 * The three arms, in the order the lifecycle drives them.
 *
 * The BASELINE arm separates the two ways the wave can fail: `alt+a` is MPD's own key, so if the
 * panel does not render there, the drawing (or the panel) is broken and the Ctrl+A arm says nothing
 * about the key hook. The two Ctrl+A arms are then MUTUALLY EXCLUSIVE on the panel title: the team
 * arm forbids the host dashboard's title and the host arm forbids the panel's, so a takeover that
 * ignores the team predicate cannot satisfy both.
 */
export const ARMS: readonly PaneAssertion[] = [
  {
    capture: "panel-baseline",
    label: "alt+a opened MPD's merged panel and it drew the dependency graph with its arrow",
    all: [PANEL_TITLE, DAG_HEADER],
    lines: [ARROW_CELL],
  },
  {
    capture: "ctrla-team",
    label: "with a live team, Ctrl+A opened MPD's merged panel and it drew the dependency graph",
    all: [PANEL_TITLE, DAG_HEADER],
    lines: [ARROW_CELL],
    none: [HOST_TITLE],
  },
  {
    capture: "ctrla-host",
    label: "with no team in the workspace, Ctrl+A still opened the HOST subagent dashboard",
    all: [HOST_TITLE],
    none: [PANEL_TITLE],
  },
  {
    capture: "settings-ctrla",
    label: "with the host's settings screen open, Ctrl+A opened NEITHER panel (the take-over lives on the plain chat screen)",
    all: [SETTINGS_SCREEN],
    none: [PANEL_TITLE, HOST_TITLE],
  },
]

/**
 * The offline engine control's arm: the SAME expectations as the take-over arm, which is what makes
 * the injected defects below flip exactly the arms they target.
 */
export const CONTROL: PaneAssertion = {
  capture: "ctrla-team",
  label: "negative control: an expectation that cannot appear must fail the engine",
  all: [/TUI-DEPS-CTRLA-CONTROL-CANNOT-APPEAR/],
}

/**
 * Remove every team record of one workspace, so the second Ctrl+A meets a workspace with no team.
 * @param workspace - the sandbox workspace whose `.mpd/team/teams/` tree is cleared.
 * @returns the record files that were removed, repo-relative when they lived under the repo.
 */
export function clearTeamRecords(workspace: string): string[] {
  /** The directory the mpd team store reads its records from. */
  const teamsDir = join(workspace, ".mpd", "team", "teams")
  /** The records removed, so the evidence names what the control actually changed. */
  const removed: string[] = []
  if (existsSync(teamsDir)) {
    for (const name of readdirSync(teamsDir)) {
      if (!name.endsWith(".json")) continue
      rmSync(join(teamsDir, name), { force: true })
      removed.push(join(teamsDir, name).replace(REPO + "/", ""))
    }
  }
  // The index is what `activeTeamId` reads; leaving it behind would let a stale pointer survive.
  rmSync(join(workspace, ".mpd", "team", "teams.json"), { force: true })
  return removed
}

/**
 * The keystroke plan of one lifecycle: settle, the baseline, the team arm, then the control arms.
 *
 * The record removal rides `TuiStep.before`, so the mutation lands between the two captures of the
 * SAME boot — which is what makes the no-team arm a control on the predicate rather than on a second
 * boot. The settings arm comes LAST, so a screen that owns the keyboard cannot influence the judged
 * take-over arms.
 * @param workspace - the sandbox workspace the team fixture was written into.
 * @param removed - receives the names of the records the control removed.
 * @returns the steps, in drive order.
 */
export function driveSteps(workspace: string, removed: string[]): TuiStep[] {
  return [
    // Any first-run overlay (the host's own splash/modal) owns the keyboard; one Escape gives it back
    // without touching the prompt, so every judged capture is taken in the plain chat state.
    { name: "settle", keys: ["Escape"], waitMs: 3000 },
    // THE BASELINE: MPD's OWN key, so the panel and the drawing are judged independently of the hook.
    { name: "panel-baseline", keys: ["M-a"], waitMs: 5000 },
    { name: "close-baseline", keys: ["Escape"], waitMs: 2500 },
    { name: "ctrla-team", keys: ["C-a"], waitMs: 5000 },
    { name: "close-panel", keys: ["Escape"], waitMs: 2500 },
    {
      name: "ctrla-host",
      keys: ["C-a"],
      waitMs: 5000,
      before: () => {
        removed.push(...clearTeamRecords(workspace))
      },
    },
    // THE EXCLUSIVE-SURFACE ARM: a host overlay owns the keyboard, so the take-over must NOT fire —
    // the hook component is unmounted while `/settings` is up, and this arm proves it on a real pane
    // rather than from the source's branch order.
    { name: "close-host", keys: ["Escape"], waitMs: 2000 },
    { name: "settings-open", keys: ["/settings", "Enter"], waitMs: 6000 },
    { name: "settings-ctrla", keys: ["C-a"], waitMs: 4000 },
    { name: "settings-close", keys: ["Escape"], waitMs: 2000 },
  ]
}

/**
 * Write the run's negative control beside the result, so a reviewer can read what was falsified.
 * @param outDir - the run's evidence directory.
 * @param evaluation - the control pass's evaluation; it must have gone RED.
 * @returns true when the control failed as required.
 */
export function writeControl(outDir: string, evaluation: PaneEvaluation): boolean {
  /** The directory the control's own artifacts live in. */
  const dir = join(outDir, "negative")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "control.json"), JSON.stringify(evaluation, null, 2) + "\n")
  return !evaluation.ok
}

/** The adapter's file sink inside the sandbox workspace the boot ran in. */
export const HOST_LOG_PATH: readonly string[] = [".mpd", "logs", "mpd-tui.log"]

/**
 * Read the adapter's host-contact line out of that sink.
 * @param workspace - the workspace the boot session ran in.
 * @returns the matching line, or undefined when the file or the line is absent.
 */
export function readHostContactLine(workspace: string): string | undefined {
  /** The log file the adapter's default sink writes. */
  const file = join(workspace, ...HOST_LOG_PATH)
  if (!existsSync(file)) return undefined
  try {
    return readFileSync(file, "utf8").split("\n").find((line) => HOST_CONTACT_LINE.test(line))
  } catch {
    return undefined
  }
}

/**
 * Judge that line against the host copy THIS LANE LAUNCHED.
 *
 * "A panel opened" cannot distinguish the host module the running TUI imported from a stale sibling
 * install, so the bound root is compared against the sandbox profile's own copy — the only one the
 * boot could have loaded.
 * @param line - the contact line, or undefined when nothing was logged.
 * @param profileDir - the sandbox's `dsh-tui` profile directory.
 * @returns the verdict, the root it named, and a reason sentence for the evidence file.
 */
export function hostContactVerdict(line: string | undefined, profileDir: string): { ok: boolean; root?: string; reason: string } {
  /** The host copy the boot must have loaded. */
  const expected = join(profileDir, "node_modules", "@deepseek-harness-tui", "dsh-tui")
  if (line === undefined) return { ok: false, reason: "the adapter logged no host-contact line" }
  /** The line's captured root, when it is the bound spelling. */
  const match = HOST_CONTACT_LINE.exec(line)
  if (match === null || match[1] === undefined) return { ok: false, reason: "the contact line does not name a bound host root: " + line }
  /** The root the adapter says it bound. */
  const root = match[1]
  return root === expected
    ? { ok: true, root, reason: "bound to the launched profile copy: " + root }
    : { ok: false, root, reason: "bound to " + root + ", not the launched profile copy " + expected }
}

/** The merged panel's captured screen, shared by the baseline arm and the Ctrl+A arm. */
function panelPane(): string {
  return " MPD subagents + team · 220x50\n" +
    " rosters\n" +
    " task dependency graph\n" +
    "┌────────────────┐\n" +
    "│ ✓ t1 REQ freeze │\n" +
    "└────────┬───────┘\n" +
    "         ▼\n" +
    "┌────────┴───────┐\n" +
    "│ ○ t2 WRK build │\n" +
    "└────────────────┘\n"
}

/** The host dashboard's captured screen, as the host itself paints it (`i18n.js`). */
function hostPane(): string {
  return " 子代理面板 \n 0 运行中   0 已完成\n ↑/↓ 选择 · Enter 查看详情 · Esc 关闭\n"
}

/** The reference panes every offline arm is judged against: one green set, then the mutants. */
function fixturePanes(): PaneText[] {
  return [
    { name: "panel-baseline", text: panelPane() },
    { name: "ctrla-team", text: panelPane() },
    { name: "ctrla-host", text: hostPane() },
    { name: "settings-ctrla", text: " 插件设置\n ╭─ MPD 插件包 (mpd) ─╮\n │ 行内 diff 上限  20000 │\n" },
  ]
}

/** The offline arm: the reference panes pass and every injected defect flips its own arm. */
function selfTest(): void {
  // The bound assertion collector: `check` records failures into `problems`.
  const { check, problems } = makeChecks()
  /** The reference evaluation every other arm is compared against. */
  const good = evaluatePanes(fixturePanes(), ARMS)
  check(good.ok, "the reference panes must satisfy every arm")
  check(good.results.length === ARMS.length, "one verdict per arm is required")

  // MUTANT 1: the arrow cell is gone (the drawing lost its arrowhead) — BOTH panel arms must fail,
  // and the host arm must stay green, so the defect cannot be mistaken for a key-hook failure.
  /** The panel captures with the arrow row replaced by a bare stub. */
  const noArrow = fixturePanes().map((pane) => (pane.name === "ctrla-host" ? pane : { ...pane, text: pane.text.replace(/^ *▼\n/m, "         │\n") }))
  /** The evaluation of that mutant. */
  const withoutArrow = evaluatePanes(noArrow, ARMS)
  check(!withoutArrow.ok, "a NEGATIVE CONTROL failed: a drawing without an arrowhead must fail the lane")
  check(withoutArrow.results[0]?.ok === false && withoutArrow.results[1]?.ok === false && withoutArrow.results[2]?.ok === true,
    "only the two panel arms may fail when the arrow is missing")

  // MUTANT 2: the takeover stopped happening — the team arm captured the HOST dashboard instead.
  /** The captures with the team arm showing the host dashboard. */
  const noTakeover = fixturePanes().map((pane) => (pane.name === "ctrla-team" ? { ...pane, text: hostPane() } : pane))
  /** The evaluation of that mutant. */
  const withoutTakeover = evaluatePanes(noTakeover, ARMS)
  check(!withoutTakeover.ok, "a NEGATIVE CONTROL failed: a takeover that never happens must fail the lane")
  check(withoutTakeover.results[0]?.ok === true && withoutTakeover.results[1]?.ok === false, "the baseline arm must stay green when only the key hook broke")

  // MUTANT 3: the takeover became UNCONDITIONAL — the host arm captured the MPD panel instead.
  /** The captures with the host arm showing the MPD panel. */
  const unconditional = fixturePanes().map((pane) => (pane.name === "ctrla-host" ? { ...pane, text: panelPane() } : pane))
  check(!evaluatePanes(unconditional, ARMS).ok, "a NEGATIVE CONTROL failed: an unconditional takeover must fail the lane")

  // MUTANT 4: the takeover fired over an exclusive host surface — the settings capture shows the panel.
  /** The captures with the settings arm showing the MPD panel. */
  const overSettings = fixturePanes().map((pane) => (pane.name === "settings-ctrla" ? { ...pane, text: panelPane() } : pane))
  check(!evaluatePanes(overSettings, ARMS).ok, "a NEGATIVE CONTROL failed: a takeover firing over the settings screen must fail the lane")

  // THE ARTIFACT-SIDE ARM: the contact verdict must accept the launched copy and reject a sibling.
  /** The sandbox profile directory the fixture verdict is judged against. */
  const profileDir = join(REPO, ".qa-tmp", "sandbox", "dshhome", "profiles", "dsh-tui")
  /** The launched copy, as the adapter's own line spells it. */
  const launched = "[mpd-tui-adapter] host contact bound: " + join(profileDir, "node_modules", "@deepseek-harness-tui", "dsh-tui") + " (lib/types/ui.js)"
  check(hostContactVerdict(launched, profileDir).ok, "the launched profile copy must satisfy the contact verdict")
  check(!hostContactVerdict(undefined, profileDir).ok, "a missing contact line must fail the contact verdict")
  check(!hostContactVerdict(launched.replace("/profiles/dsh-tui", "/profiles/other"), profileDir).ok, "a sibling install must fail the contact verdict")

  // THE ENGINE CONTROL: the factory's own expectation, re-run with one impossible requirement.
  check(!evaluatePanes(fixturePanes(), [CONTROL]).ok, "the negative control must fail on an expectation that cannot appear")

  check(existsSync(join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js")), "the built plugin dist is missing")
  // The skill document that must list this case, or the case is unreachable.
  const skill = join(REPO, "skills", "dsh-qa", "SKILL.md")
  check(existsSync(skill) && readFileSync(skill, "utf8").includes("| tui-deps-ctrla |"), "the case table does not list tui-deps-ctrla")

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: " + ARMS.length + " arms asserted, 4 injected defects + the engine and contact controls fail as required")
}

/** The live arm: one real TUI lifecycle, three judged captures, one negative control. */
function real(): void {
  // The lane's own command line; the sandbox flags are read from this slice.
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
  gateTuiPrereqs(SLUG, tuiPrereqs({ sandboxPresent: () => state.present && state.hasHost === true && state.hasBundle === true }))

  // The workspace the boot session runs in; the fixture and the control both act on THIS tree.
  const workspace = join(root, "ws")
  // The seeded team: two tasks, `t2` blocked by `t1`, so the drawing has a real edge to arrow.
  const fixture = writeTeamFixture(workspace, stagedRecord())
  say("seeded team fixture at " + fixture.file.replace(REPO + "/", ""))
  // The records the host arm's `before` hook removes; filled during the drive.
  const removed: string[] = []

  // The whole lifecycle: boot, settle, team arm, close, clear the records, host arm.
  const session = runTuiSession({ lane: SLUG, root, outDir, steps: driveSteps(workspace, removed) })
  for (const failure of session.failures) say("lifecycle: " + failure)
  say("records removed for the control arm: " + (removed.length === 0 ? "(none)" : removed.join(", ")))

  // The judged arms, then the engine's own negative control on the very same captures.
  const evaluation = evaluatePanes(session.panes, ARMS)
  // The control pass: the same captures judged against one expectation that cannot appear.
  const control = evaluatePanes(session.panes, [CONTROL])
  // True when the control went RED, which is the only outcome that makes this run's verdict usable.
  const controlFailedAsRequired = writeControl(outDir, control)
  // THE ARTIFACT-SIDE HALF: which host copy the adapter actually bound, read from its own log sink.
  const hostContact = hostContactVerdict(readHostContactLine(workspace), join(root, "dshhome", "profiles", "dsh-tui"))
  say("host contact: " + hostContact.reason)

  // The artifact must not have moved under the run, or the result describes neither revision.
  const revisionAfter = artifactRevision()
  // The before/after comparison recorded in REVISION.json and re-stated in the result payload.
  const delta = revisionDelta(revisionBefore, revisionAfter)
  // The REVISION.json written beside the result, whose path the payload names for the reviewer.
  const revisionFile = writeRevisionFile(outDir, {
    before: revisionBefore,
    after: revisionAfter,
    composition: { sandboxRoot: root.replace(REPO + "/", ""), profile: "dsh-tui", arms: ARMS.length },
  })

  /** The lane's verdict: every arm green, the control red, the contact bound to THIS install, the lifecycle clean, the artifact settled. */
  const ok = evaluation.ok && controlFailedAsRequired && hostContact.ok && session.failures.length === 0 && !delta.changed
  writeLaneEvidence(outDir, SLUG, {
    ok,
    revision: revisionAfter,
    revisionDelta: delta,
    revisionFile: revisionFile.file.replace(REPO + "/", ""),
    arms: evaluation.results,
    hostContact,
    teamFixture: { file: fixture.file.replace(REPO + "/", ""), sha256: fixture.sha256, recordsRemoved: removed },
    negativeControl: { expected: "fail", observed: control.ok, artifact: "negative/control.json" },
    lifecycleFailures: session.failures,
    panes: session.panes.map((pane) => ({ name: pane.name, file: pane.file.replace(REPO + "/", ""), chars: pane.text.length })),
    sandboxRoot: root.replace(REPO + "/", ""),
  }, log.join("\n"))

  if (!ok) {
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify(evaluation.results.filter((verdict) => !verdict.ok)).slice(0, 1500))
    process.exit(1)
  }
  console.log("[" + SLUG + "] PASS: Ctrl+A opened the MPD panel with the arrow drawn, and the host dashboard without a team")
}

// Entry guard: importing this lane (e.g. to reuse evaluatePanes or the arms) must never start a live
// run. The self-test and the real lane run only when this file IS the process entry point.
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest()
  else real()
}
