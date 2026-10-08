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
// PREREQ: absent-dsh-binary dsh-tui "npm i -g @deepseek-harness-tui/dsh-tui@0.14.0"
// PREREQ: absent-runtime tmux "install tmux; the TUI requires a real TTY"
// PREREQ: absent-fixture tui profile in the sandbox root "bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root <root> --install"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-deps-ctrla.ts --self-test
//   bun skills/dsh-qa/scripts/tui-deps-ctrla.ts [--sandbox-root <dir>] [--fresh]
// Evidence -> evidence/tui/lanes/<timestamp>/{result.json,output.log,*.pane.txt,negative/control.json}
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  REPO, artifactRevision, gateTuiPrereqs, hostPanelSeam, laneEvidenceDir, makeChecks, parseSandboxArgs, profileState, provisionTuiHome,
  readCommandRecords, revisionDelta, runTuiSession, sandboxSessionIds, tuiPrereqs, writeLaneEvidence, writeRevisionFile,
} from "./lib/tui-lane.ts"
import type { CommandRecordSet, TuiStep } from "./lib/tui-lane.ts"
import { stagedRecord, writeTeamFixture } from "./tui-team-surface.ts"

/** The case slug: names the evidence directory, the private tmux socket and every log prefix. */
export const SLUG: string = "tui-deps-ctrla"

/** The merged panel's own scene title, printed by the panel's first row (frozen by the scene contract). */
export const PANEL_TITLE: RegExp = /MPD subagents \+ team/

/**
 * The host's own dashboard title, in every language the host ships (`i18n.js`).
 *
 * 0.14.0 rewrote the host's panel bar into a CAROUSEL that draws the ACTIVE tab's own title, and the
 * subagent dashboard's tab is `panel-title-agents` — `代理` / `Agents` — not the older `子代理面板` /
 * `Subagent Dashboard` pair, which is why the two Ctrl+A arms read as missing on a pane that WAS the
 * host's own surface (MEASURED: `evidence/tui/lanes/2026-10-08T03-06-38.202Z/ctrla-team.pane.txt` paints
 * `◀     ○     ○     ○     ○    代理   ○ … ▶`). The R4 invariant is unaffected — what those arms assert
 * is still that the pane carries the HOST's surface, never MPD's.
 */
export const HOST_TITLE: RegExp = /代理|Agents|Subagent Dashboard/

/** The header both MPD scenes print directly above the drawing. */
export const DAG_HEADER: RegExp = /task dependency graph/

/** The host settings screen's own frame, which lists this bundle's section (either language). */
export const SETTINGS_SCREEN: RegExp = /MPD 插件包|MPD bundle/

/**
 * The panel slug this bundle DECLARES, from `packages/mpd-tui-plugin/src/panel.ts` (`PANEL_SLUG`).
 *
 * The host composes the FINAL id by prefixing the calling activation's plugin id — `act<N>` for our
 * plain loader row, measured 2026-10-06 as `act1:team` — so the lane asserts the composition shape
 * (the last `:`-separated segment IS our declared slug) rather than either half by itself.
 */
export const PANEL_SLUG: string = "team"

/**
 * The panel's own "the host accepted it" sentence, from `packages/mpd-tui-plugin/src/i18n.ts` key
 * `panel.opened` (`mpd 侧栏面板：宿主已接受 {id}；…` / `mpd sidebar panel: the host accepted {id}; …`).
 *
 * The RETIRED wording this pattern used to carry (`侧栏面板：已打开` / `sidebar panel: opened`) was
 * replaced in `i18n.ts` by commit `fb7ffddc` (2026-10-06T22:27+08:00) and this matcher was not moved
 * with it; `i18n.ts` is untouched by this wave, so a pattern holding the old literal can never match a
 * real boot — MEASURED: the store arm of this very lane reported it as its only `missing` pattern while
 * the recorded sentence WAS the accepted one (`evidence/tui/lanes/2026-10-08T03-06-38.202Z/result.json`).
 */
export const PANEL_OPENED_TEXT: RegExp = /侧栏面板：宿主已接受|sidebar panel: the host accepted/
/**
 * The `{id}` that accepted sentence names.
 *
 * There is no parenthetical around the id — the sentence's only parentheses carry its tail hint — so a
 * reader taking the first parenthesis reports the hint, not the id: MEASURED, the same result payload's
 * `"id": "或开启"启动时展开侧栏""`. The clause's own words are the anchor.
 */
export const PANEL_OPENED_ID: RegExp = /(?:宿主已接受|the host accepted)\s+([^\s；;，,]+)/

/** The two `/mpd panel` outcomes that are NOT a registration proof: a refusal, or no seam at all. */
export const PANEL_OTHER_OUTCOMES: readonly RegExp[] = [/侧栏面板：宿主拒绝|sidebar panel: the host refused/, /该宿主不提供面板接缝|this host exposes no panel seam/]

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
 * One store-backed arm: what the HARNESS's own command records must prove.
 *
 * A pane cannot carry the panel's body on 0.13.0 (see {@link PANEL_BODY_BOUND}), so the entry-point
 * half of this lane is read from the harness's `command/run` + `command/done` pair and from the
 * plugin's own printed sentence, which distinguishes the three routed outcomes.
 */
export interface StoreAssertion {
  /** Human-readable statement of what a pass proves, recorded per result. */
  readonly label: string
  /** The command name the `command/run` record must carry. */
  readonly name: string
  /** The `command/run.args` spelling the invocation must carry. */
  readonly args: RegExp
  /** The `kind` the correlated `command/done` must carry. */
  readonly doneKind: string
  /** Patterns the completion's text must each match. */
  readonly text: readonly RegExp[]
  /** Patterns the completion's text must NOT match. */
  readonly none?: readonly RegExp[]
}

/** What one store arm actually saw. */
export interface StoreVerdict {
  /** The arm's own statement of what a pass proves. */
  readonly label: string
  /** The required text patterns that did not match, stringified. */
  readonly missing: readonly string[]
  /** The forbidden patterns that DID match, stringified. */
  readonly forbidden: readonly string[]
  /** The completion text the arm judged, or `""` when no correlated completion existed. */
  readonly text: string
  /** The panel id the sentence named, when the completion carried one. */
  readonly id?: string
  /** True when the pair existed, every required pattern matched and nothing forbidden appeared. */
  readonly ok: boolean
}

/**
 * Judge the store arms against one run's command records.
 *
 * The two halves are checked in order and each failure is NAMED: a missing `command/run` proves the
 * registry never received the command, a missing completion proves the handler did not finish, a
 * non-success kind proves it failed, and a text mismatch proves the routed outcome was not the one
 * asserted. A pure function, so the self-test falsifies it on synthetic records without a terminal.
 * @param records - the command records of this run.
 * @param arms - the store assertions to apply.
 * @returns the evaluation, with one verdict per arm.
 */
export function evaluateStoreArms(records: CommandRecordSet, arms: readonly StoreAssertion[]): { ok: boolean; results: StoreVerdict[] } {
  /** The verdicts, in plan order. */
  const results: StoreVerdict[] = []
  for (const arm of arms) {
    /** The invocations matching the declared name and arguments. */
    const runs = records.runs.filter((run) => String(run.name ?? "") === arm.name && arm.args.test(String(run.args ?? "")))
    /** The completion correlated with the LAST matching invocation, i.e. this run's own press. */
    const id = String(runs.at(-1)?.commandId ?? "")
    /** The completion the harness recorded for that invocation, when there is one. */
    const done = id === "" ? undefined : records.dones.find((entry) => String(entry.commandId ?? "") === id)
    /** The printed sentence, or `""` when the pair is incomplete. */
    const text = String((done as { text?: unknown } | undefined)?.text ?? "")
    /** Everything that did not hold, in check order. */
    const missing: string[] = []
    if (runs.length === 0) missing.push("no command/run with name=" + arm.name + " args=" + String(arm.args))
    else if (done === undefined) missing.push("command/run " + id + " has no correlating command/done")
    else if (String(done.kind ?? "") !== arm.doneKind) missing.push("command/done kind=" + String(done.kind) + " (expected " + arm.doneKind + ")")
    if (done !== undefined) missing.push(...arm.text.filter((pattern) => !pattern.test(text)).map(String))
    /** The forbidden patterns that DID match; a refusal or a no-seam sentence must never be accepted. */
    const forbidden = done === undefined ? [] : (arm.none ?? []).filter((pattern) => pattern.test(text)).map(String)
    /** The id the sentence named, read from its accepted clause. */
    const panelId = PANEL_OPENED_ID.exec(text)?.[1]
    results.push({ label: arm.label, missing, forbidden, text, id: panelId, ok: missing.length === 0 && forbidden.length === 0 })
  }
  return { ok: results.every((verdict) => verdict.ok), results }
}

/**
 * The measured LIMIT of the 0.13.0 arm, carried into every result so no reader reads it as a render.
 *
 * MEASURED 2026-10-06 on the 0.13.0 fixture: `/mpd panel` reported a host-ACCEPTED open
 * (`mpd 侧栏面板：已打开（act1:team）`) and the 320x50 pane was BYTE-IDENTICAL before and after; `alt+a`
 * and `/mpd subagents` route through the SAME `openMergedPanel()`, so on a host with the seam there is
 * NO pane-capturable MPD dependency view left — `/mpd board` still opens a full-screen scene, but that
 * scene is the BOARD, not the DAG. The arrow/drawing arms below are therefore kept ONLY for the host
 * without the seam (where they were measured green on 0.12.0), and the merged view on 0.13.0 is proven
 * by registration + accepted open instead. The DAG body itself is NOT claimed to render here.
 */
export const PANEL_BODY_BOUND: string =
  "on a host with the tuiPanels seam the merged view is the SIDEBAR panel: a host-accepted open changed "
  + "ZERO bytes of the captured pane, and both MPD entry points route to it — so this lane proves the "
  + "registration and the accepted open, and does NOT claim the panel body (or its arrow) renders"

/** The panel-registration store arm asserted on a host WITH the seam. */
export const PANEL_STORE_ARM: StoreAssertion = {
  label: "on a host WITH the panel seam, `/mpd panel` reached the SIDEBAR panel: the host's list() read-back produced an id for OUR slug and accepted the open",
  name: "mpd",
  args: /panel/,
  doneKind: "success",
  text: [PANEL_OPENED_TEXT, PANEL_OPENED_ID],
  none: PANEL_OTHER_OUTCOMES,
}

/**
 * The page arms of one host: VERSION-CONDITIONAL since 0.13.0.
 *
 * With the `tuiPanels` seam PRESENT the legacy Ctrl+A contact is INERT (frozen R4), so BOTH Ctrl+A
 * arms must capture the HOST's own dashboard — the team arm is no longer distinguished from the
 * no-team arm, because the panel seam outranks the team predicate entirely. With the seam ABSENT the
 * pre-0.13.0 behaviour stands unchanged (frozen R5): a live team makes Ctrl+A open MPD's merged panel,
 * and the no-team arm is the negative control on that predicate.
 * @param seamPresent - whether the launched host offers the `tuiPanels` seam.
 * @returns the arms to apply, in drive order.
 */
export function armsFor(seamPresent: boolean): readonly PaneAssertion[] {
  if (seamPresent) {
    return [
      {
        capture: "ctrla-team",
        label: "with a live team, Ctrl+A opened the HOST's own subagent dashboard — the MPD contact is INERT on a host that offers the panel seam (frozen R4)",
        all: [HOST_TITLE],
        none: [PANEL_TITLE],
      },
      {
        capture: "ctrla-host",
        label: "with no team in the workspace, Ctrl+A still opened the HOST subagent dashboard",
        all: [HOST_TITLE],
        none: [PANEL_TITLE],
      },
      {
        capture: "settings-ctrla",
        label: "with the host's settings screen open, Ctrl+A opened NEITHER panel (the host keeps its own exclusive surface)",
        all: [SETTINGS_SCREEN],
        none: [PANEL_TITLE, HOST_TITLE],
      },
    ]
  }
  return [
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
}

/** The pre-0.13.0 arm list, kept named so the offline arm still falsifies the R5 behaviour directly. */
export const LEGACY_ARMS: readonly PaneAssertion[] = armsFor(false)

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
 * The keystroke plan of one lifecycle: settle, MPD's own entry point, then the Ctrl+A arms.
 *
 * VERSION-CONDITIONAL, and the difference is the POINT of this wave. On a host WITH the panel seam
 * MPD's entry point is `/mpd panel` (which prints the routed outcome, so it is the store arm's
 * witness) and `alt+a` is NOT driven: it routes through the SAME `openMergedPanel()` and lands on the
 * invisible sidebar, so its capture would assert nothing (see {@link PANEL_BODY_BOUND}). On a host
 * WITHOUT the seam `alt+a` is the merged full-screen scene and stays the baseline arm.
 *
 * The record removal rides `TuiStep.before`, so the mutation lands between the two Ctrl+A captures of
 * the SAME boot — which is what makes the no-team arm a control on the predicate rather than on a
 * second boot. The settings arm comes LAST, so a screen that owns the keyboard cannot influence the
 * judged Ctrl+A arms.
 * @param workspace - the sandbox workspace the team fixture was written into.
 * @param removed - receives the names of the records the control removed.
 * @param seamPresent - whether the launched host offers the `tuiPanels` seam.
 * @returns the steps, in drive order.
 */
export function driveSteps(workspace: string, removed: string[], seamPresent: boolean): TuiStep[] {
  /** The steps shared by both hosts: settle, the team arm, the host arm, the exclusive-surface arm. */
  const common: TuiStep[] = [
    // Any first-run overlay (the host's own splash/modal) owns the keyboard; one Escape gives it back
    // without touching the prompt, so every judged capture is taken in the plain chat state.
    { name: "settle", keys: ["Escape"], waitMs: 3000 },
    { name: "ctrla-team", keys: ["C-a"], waitMs: 5000 },
    { name: "close-team", keys: ["Escape"], waitMs: 2500 },
    {
      name: "ctrla-host",
      keys: ["C-a"],
      waitMs: 5000,
      before: () => {
        removed.push(...clearTeamRecords(workspace))
      },
    },
    // THE EXCLUSIVE-SURFACE ARM: a host overlay owns the keyboard, so the contact must NOT fire —
    // the hook component is unmounted while `/settings` is up, and this arm proves it on a real pane
    // rather than from the source's branch order.
    { name: "close-host", keys: ["Escape"], waitMs: 2000 },
    { name: "settings-open", keys: ["/settings", "Enter"], waitMs: 6000 },
    { name: "settings-ctrla", keys: ["C-a"], waitMs: 4000 },
    { name: "settings-close", keys: ["Escape"], waitMs: 2000 },
  ]
  // THE BASELINE, only where it is observable: on the legacy host `alt+a` opens the merged SCENE.
  const baseline: TuiStep[] = [
    { name: "panel-baseline", keys: ["M-a"], waitMs: 5000 },
    { name: "close-baseline", keys: ["Escape"], waitMs: 2500 },
  ]
  // On a host with the seam the entry-point half rides `/mpd panel`, whose printed sentence the store
  // arm reads; it precedes the Ctrl+A arms so the team record is still present for the team arm.
  const panelCommand: TuiStep[] = [
    { name: "panel-command", keys: ["/mpd panel", "Enter"], waitMs: 7000 },
    { name: "close-panel-command", keys: ["Escape"], waitMs: 2500 },
  ]
  if (seamPresent) return [common[0], ...panelCommand, ...common.slice(1)]
  return [common[0], ...baseline, ...common.slice(1)]
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
  const good = evaluatePanes(fixturePanes(), LEGACY_ARMS)
  check(good.ok, "the reference panes must satisfy every legacy arm")
  check(good.results.length === LEGACY_ARMS.length, "one verdict per arm is required")

  // MUTANT 1: the arrow cell is gone (the drawing lost its arrowhead) — BOTH panel arms must fail,
  // and the host arm must stay green, so the defect cannot be mistaken for a key-hook failure.
  /** The panel captures with the arrow row replaced by a bare stub. */
  const noArrow = fixturePanes().map((pane) => (pane.name === "ctrla-host" ? pane : { ...pane, text: pane.text.replace(/^ *▼\n/m, "         │\n") }))
  /** The evaluation of that mutant. */
  const withoutArrow = evaluatePanes(noArrow, LEGACY_ARMS)
  check(!withoutArrow.ok, "a NEGATIVE CONTROL failed: a drawing without an arrowhead must fail the lane")
  check(withoutArrow.results[0]?.ok === false && withoutArrow.results[1]?.ok === false && withoutArrow.results[2]?.ok === true,
    "only the two panel arms may fail when the arrow is missing")

  // MUTANT 2: the takeover stopped happening — the team arm captured the HOST dashboard instead.
  /** The captures with the team arm showing the host dashboard. */
  const noTakeover = fixturePanes().map((pane) => (pane.name === "ctrla-team" ? { ...pane, text: hostPane() } : pane))
  /** The evaluation of that mutant. */
  const withoutTakeover = evaluatePanes(noTakeover, LEGACY_ARMS)
  check(!withoutTakeover.ok, "a NEGATIVE CONTROL failed: a takeover that never happens must fail the lane")
  check(withoutTakeover.results[0]?.ok === true && withoutTakeover.results[1]?.ok === false, "the baseline arm must stay green when only the key hook broke")

  // MUTANT 3: the takeover became UNCONDITIONAL — the host arm captured the MPD panel instead.
  /** The captures with the host arm showing the MPD panel. */
  const unconditional = fixturePanes().map((pane) => (pane.name === "ctrla-host" ? { ...pane, text: panelPane() } : pane))
  check(!evaluatePanes(unconditional, LEGACY_ARMS).ok, "a NEGATIVE CONTROL failed: an unconditional takeover must fail the lane")

  // MUTANT 4: the takeover fired over an exclusive host surface — the settings capture shows the panel.
  /** The captures with the settings arm showing the MPD panel. */
  const overSettings = fixturePanes().map((pane) => (pane.name === "settings-ctrla" ? { ...pane, text: panelPane() } : pane))
  check(!evaluatePanes(overSettings, LEGACY_ARMS).ok, "a NEGATIVE CONTROL failed: a takeover firing over the settings screen must fail the lane")

  // ── THE FLIPPED (0.13.0) ARM SET ────────────────────────────────────────────────────────────────
  // On a host WITH the panel seam BOTH Ctrl+A captures are the HOST dashboard, so the reference panes
  // for that host must present the host dashboard in the team arm too.
  /** The reference captures of a host with the seam: Ctrl+A is inert, so both Ctrl+A arms show the host. */
  const seamPanes = fixturePanes().map((pane) => (pane.name === "ctrla-team" ? { ...pane, text: hostPane() } : pane))
  /** The 0.13.0 arms, applied to their own reference captures. */
  const seamArms = armsFor(true)
  check(evaluatePanes(seamPanes, seamArms).ok, "the reference panes of a host WITH the seam must satisfy the flipped arms")
  // THE FLIP'S OWN NEGATIVE CONTROL: a team arm that still shows the MPD merged panel is EXACTLY the
  // defect this wave prevents (an armed contact on a host that offers the seam), so it must redden.
  /** The host-with-seam captures where Ctrl+A wrongly landed on MPD's panel. */
  const stillArmed = seamPanes.map((pane) => (pane.name === "ctrla-team" ? { ...pane, text: panelPane() } : pane))
  /** The evaluation of that mutant. */
  const armed = evaluatePanes(stillArmed, seamArms)
  check(!armed.ok, "a NEGATIVE CONTROL failed: an ARMED contact on a host with the panel seam must fail the lane")
  check(armed.results[0]?.ok === false && (armed.results[0]?.forbidden.length ?? 0) === 1, "the forbidden panel title must be what reddens the team arm")
  // And a Ctrl+A that opened NOTHING must redden too: the host's own dashboard is the asserted outcome.
  check(!evaluatePanes(seamPanes.map((pane) => (pane.name === "ctrla-team" ? { ...pane, text: "> " } : pane)), seamArms).ok,
    "a NEGATIVE CONTROL failed: a Ctrl+A that opened nothing must fail the team arm")
  // The exclusive-surface arm survives the flip unchanged.
  check(!evaluatePanes(seamPanes.map((pane) => (pane.name === "settings-ctrla" ? { ...pane, text: panelPane() } : pane)), seamArms).ok,
    "a NEGATIVE CONTROL failed: an overlay over the settings screen must fail the flipped arm set")

  // ── THE STORE ARM (the 0.13.0 entry-point proof) ────────────────────────────────────────────────
  /** The reference command records: `/mpd panel` invoked and completed with the panel-OPENED sentence. */
  const storeFixture: CommandRecordSet = {
    runs: [{ sessionId: "s1", commandId: "cmd-1", name: "mpd", args: " panel" }],
    dones: [{ sessionId: "s1", commandId: "cmd-1", kind: "success", text: "mpd 侧栏面板：宿主已接受 act1:team；若没有出现面板，请在 /settings → 侧栏里把 act1:team 加入面板列表，并按 Ctrl+B 展开（或开启“启动时展开侧栏”）" }],
  }
  /** The reference store evaluation every mutant below is compared against. */
  const storeGood = evaluateStoreArms(storeFixture, [PANEL_STORE_ARM])
  check(storeGood.ok, "the reference records must satisfy the panel store arm")
  check(storeGood.results[0]?.id === "act1:team", "the store arm must surface the host's discovered panel id")
  check(storeGood.results[0]?.id?.endsWith(":" + PANEL_SLUG) === true, "the discovered id must end with this bundle's declared slug")
  // MUTANT S1: no invocation at all — the registry never received `/mpd panel`.
  check(!evaluateStoreArms({ runs: [], dones: storeFixture.dones }, [PANEL_STORE_ARM]).ok, "a NEGATIVE CONTROL failed: a missing command/run must fail the store arm")
  // MUTANT S2: the invocation with no completion — the handler never finished.
  check(!evaluateStoreArms({ runs: storeFixture.runs, dones: [] }, [PANEL_STORE_ARM]).ok, "a NEGATIVE CONTROL failed: a missing command/done must fail the store arm")
  // MUTANT S3: the completion reported a FAILURE kind.
  check(!evaluateStoreArms({ runs: storeFixture.runs, dones: [{ ...storeFixture.dones[0], kind: "error" }] }, [PANEL_STORE_ARM]).ok,
    "a NEGATIVE CONTROL failed: a non-success completion must fail the store arm")
  // MUTANT S4: the host REFUSED the open (the panel sentence is not the one asserted).
  check(!evaluateStoreArms({ runs: storeFixture.runs, dones: [{ ...storeFixture.dones[0], text: "mpd 侧栏面板：宿主拒绝了打开请求（act1:team），已改为全屏面板" }] }, [PANEL_STORE_ARM]).ok,
    "a NEGATIVE CONTROL failed: a refused open must fail the store arm")
  // MUTANT S5: the host offers NO seam, so the routed open fell back to the scene.
  check(!evaluateStoreArms({ runs: storeFixture.runs, dones: [{ ...storeFixture.dones[0], text: "mpd 侧栏面板：该宿主不提供面板接缝，使用全屏面板" }] }, [PANEL_STORE_ARM]).ok,
    "a NEGATIVE CONTROL failed: a host without the panel seam must fail the store arm")
  // MUTANT S6: the RETIRED sentence. The corrected matcher must still REJECT the wording it replaced,
  // or "the host accepted the open" could be proven by a sentence no build prints any more.
  check(!evaluateStoreArms({ runs: storeFixture.runs, dones: [{ ...storeFixture.dones[0], text: "mpd 侧栏面板：已打开（act1:team）" }] }, [PANEL_STORE_ARM]).ok,
    "a NEGATIVE CONTROL failed: the RETIRED `已打开` wording must fail the corrected store arm")

  // ── THE VERSION PROBE ──────────────────────────────────────────────────────────────────────────
  // The branch is decided from the LAUNCHED host payload, so an absent profile must read as "no seam"
  // rather than throwing, and a payload that carries BOTH readings must be recognised as the seam.
  /** A throwaway profile the two probe arms are built in; removed before the arm returns. */
  const probeRoot = mkdtempSync(join(tmpdir(), "tui-ctrla-probe-"))
  try {
    check(hostPanelSeam(join(probeRoot, "absent")).present === false, "a profile without a host payload must read as NO panel seam")
    /** A payload that carries the host's own row declaration and the seam module. */
    const withSeam = join(probeRoot, "with-seam", "node_modules", "@deepseek-harness-tui", "dsh-tui")
    mkdirSync(join(withSeam, "lib", "types", "dsh-adapter"), { recursive: true })
    writeFileSync(join(withSeam, "cordis.patch.yml"), "    - id: dsh-tui-panels\n")
    writeFileSync(join(withSeam, "lib", "types", "dsh-adapter", "panels.js"), "// seam payload\n")
    writeFileSync(join(withSeam, "package.json"), JSON.stringify({ version: "0.14.0" }))
    /** The probe of that payload. */
    const seamProbe = hostPanelSeam(join(probeRoot, "with-seam"))
    check(seamProbe.present === true && seamProbe.rowDeclared === true && seamProbe.modulePresent === true, "a host payload declaring the row and shipping the module must read as the PRESENT seam")
    check(seamProbe.hostVersion === "0.14.0", "the probe must read the host's own version")
    // ONE reading alone must NOT be enough: a leftover module without the row is a stale sibling.
    /** The same payload with the row declaration removed. */
    const staleRoot = join(probeRoot, "stale", "node_modules", "@deepseek-harness-tui", "dsh-tui")
    mkdirSync(join(staleRoot, "lib", "types", "dsh-adapter"), { recursive: true })
    writeFileSync(join(staleRoot, "cordis.patch.yml"), "    - id: dsh-tui-base\n")
    writeFileSync(join(staleRoot, "lib", "types", "dsh-adapter", "panels.js"), "// seam payload\n")
    check(hostPanelSeam(join(probeRoot, "stale")).present === false, "a NEGATIVE CONTROL failed: a leftover module without the row declaration must not claim the seam")
  } finally {
    rmSync(probeRoot, { recursive: true, force: true })
  }

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
  console.log("[" + SLUG + " self-test] ok: " + LEGACY_ARMS.length + " legacy + " + armsFor(true).length + " seam-present arms asserted; the arrow, the takeover, the flip, the store pair and the contact controls all fail as required")
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
  // THE VERSION BRANCH: read from the LAUNCHED host payload the profile's rows resolve to, never from
  // the installed global package — the wave's whole flip (frozen R4/R5) hangs off this one reading.
  const profileDir = join(root, "dshhome", "profiles", "dsh-tui")
  /** The launched host's panel-seam reading, with the reason it reached it. */
  const seam = hostPanelSeam(profileDir)
  /** Whether THAT host offers the panel seam: the version branch every arm below reads. */
  const seamPresent = seam.present
  say("panel seam: " + seam.reason)
  // The two file-shaped 0.13.0 gates are provisioned here as well, so this lane works on a fresh root.
  const homeFixture = provisionTuiHome(root)
  say("dsh-tui home fixture=" + homeFixture.evidence.join(", ") + " preset=" + homeFixture.preset)
  // The session ids present BEFORE the boot, so the store arm reads only records THIS run wrote: a
  // warm shared root carries earlier runs' `/mpd panel` records, and `readdir` order is not time order.
  const baselineSessions = new Set(sandboxSessionIds(root))
  // The pane arms for THIS host; the store arm exists only where a panel can be reached.
  const paneArms = armsFor(seamPresent)
  // The seeded team: two tasks, `t2` blocked by `t1`, so the drawing has a real edge to arrow.
  const fixture = writeTeamFixture(workspace, stagedRecord())
  say("seeded team fixture at " + fixture.file.replace(REPO + "/", ""))
  // The records the host arm's `before` hook removes; filled during the drive.
  const removed: string[] = []

  // The whole lifecycle: boot, settle, MPD's entry point, then the Ctrl+A arms.
  const session = runTuiSession({ lane: SLUG, root, outDir, steps: driveSteps(workspace, removed, seamPresent) })
  for (const failure of session.failures) say("lifecycle: " + failure)
  say("records removed for the control arm: " + (removed.length === 0 ? "(none)" : removed.join(", ")))

  // The judged arms, then the engine's own negative control on the very same captures.
  const evaluation = evaluatePanes(session.panes, paneArms)
  // The control pass: the same captures judged against one expectation that cannot appear.
  const control = evaluatePanes(session.panes, [CONTROL])
  // True when the control went RED, which is the only outcome that makes this run's verdict usable.
  const controlFailedAsRequired = writeControl(outDir, control)
  // THE ARTIFACT-SIDE HALF: which host copy the adapter actually bound, read from its own log sink.
  const hostContact = hostContactVerdict(readHostContactLine(workspace), join(root, "dshhome", "profiles", "dsh-tui"))
  say("host contact: " + hostContact.reason)
  // THE STORE HALF (0.13.0): the panel store arm is asserted only where the seam is present, because
  // that is the only host on which `/mpd panel` can reach a panel at all. Only THIS run's records are
  // judged, so an earlier run's invocation cannot stand in for one that never happened here.
  const store = readCommandRecords(root)
  /** Only THIS run's records: the store arm must not be satisfied by an earlier run's invocation. */
  const fresh: CommandRecordSet = {
    runs: store.runs.filter((run) => !baselineSessions.has(run.sessionId)),
    dones: store.dones.filter((done) => !baselineSessions.has(done.sessionId)),
  }
  /** The store arm's verdict over this run's records; no arm is asserted on a seam-less host. */
  const storeEvaluation = evaluateStoreArms(fresh, seamPresent ? [PANEL_STORE_ARM] : [])
  say("store arm: " + (seamPresent ? storeEvaluation.results.map((verdict) => "ok=" + verdict.ok + " id=" + String(verdict.id)).join(" ") : "(not asserted: the host has no panel seam)"))
  say("panel body bound: " + PANEL_BODY_BOUND)

  // The artifact must not have moved under the run, or the result describes neither revision.
  const revisionAfter = artifactRevision()
  // The before/after comparison recorded in REVISION.json and re-stated in the result payload.
  const delta = revisionDelta(revisionBefore, revisionAfter)
  // The REVISION.json written beside the result, whose path the payload names for the reviewer.
  const revisionFile = writeRevisionFile(outDir, {
    before: revisionBefore,
    after: revisionAfter,
    composition: { sandboxRoot: root.replace(REPO + "/", ""), profile: "dsh-tui", arms: paneArms.length, panelSeamPresent: seamPresent },
  })

  /** The lane's verdict: every arm green, the control red, the contact bound to THIS install, the lifecycle clean, the artifact settled. */
  const ok = evaluation.ok && storeEvaluation.ok && controlFailedAsRequired && hostContact.ok && session.failures.length === 0 && !delta.changed
  writeLaneEvidence(outDir, SLUG, {
    ok,
    revision: revisionAfter,
    revisionDelta: delta,
    revisionFile: revisionFile.file.replace(REPO + "/", ""),
    panelSeam: seam,
    panelSeamPresent: seamPresent,
    panelBodyBound: PANEL_BODY_BOUND,
    arms: evaluation.results,
    storeArms: storeEvaluation.results,
    hostContact,
    teamFixture: { file: fixture.file.replace(REPO + "/", ""), sha256: fixture.sha256, recordsRemoved: removed },
    negativeControl: { expected: "fail", observed: control.ok, artifact: "negative/control.json" },
    lifecycleFailures: session.failures,
    panes: session.panes.map((pane) => ({ name: pane.name, file: pane.file.replace(REPO + "/", ""), chars: pane.text.length })),
    sandboxRoot: root.replace(REPO + "/", ""),
  }, log.join("\n"))

  if (!ok) {
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify({ arms: evaluation.results.filter((verdict) => !verdict.ok), storeArms: storeEvaluation.results.filter((verdict) => !verdict.ok) }).slice(0, 1500))
    process.exit(1)
  }
  console.log("[" + SLUG + "] PASS: " + (seamPresent
    ? "the host's Ctrl+A stayed INERT (its own dashboard opened) and /mpd panel proved the sidebar registration + accepted open"
    : "Ctrl+A opened the MPD panel with the arrow drawn, and the host dashboard without a team"))
}

// Entry guard: importing this lane (e.g. to reuse evaluatePanes or the arms) must never start a live
// run. The self-test and the real lane run only when this file IS the process entry point.
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest()
  else real()
}
