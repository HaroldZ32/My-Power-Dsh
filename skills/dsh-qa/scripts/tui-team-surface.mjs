#!/usr/bin/env bun
// Case tui-team-surface: prove the TUI team-workflow + plan-approval surfaces
//
// CLAIM SET (T-80): this driver CLAIMS the assertion keys A1–A8 and A10 — the same keys its own
// `add("A…")` calls produce below. A claimed-but-unasserted key, or a produced-but-unclaimed one,
// is a defect the corpus arm reports with this path and the key.
// (`packages/mpd-tui-plugin`, frozen contract `.mpd/plans/tui-team-surface.md`)
// GATE A REAL MUTATION on a real host, and that the gate can be seen to fail.
//
// Two arms, both driven against a REAL staged-team record written to disk (never a
// hand-built object) inside an isolated sandbox:
//
//   ARM 1 — the bundle's own wiring, no TTY.  The lane calls the plugin's REAL
//     `apply()` from the built dist with a host double, takes the `mpd-tui-plan`
//     component the plugin registered, renders it, and types the frozen phrase one
//     keystroke at a time.  The mutation leaves through the REAL
//     `mpd-dsh-adapter-plugin` instance (`createDshAdapter`), so the recorded
//     harness-boundary call is the bundle's own code path, not a stand-in for it.
//
//   ARM 2 — the REAL dsh-TUI host in tmux, driven by real keystrokes, with the
//     staged record in the SANDBOX workspace.  The record is the truth source: an
//     approval that the pane claims but the file does not show is a FAIL, and so is
//     a file change the pane denies.
//
// THE NEGATIVE CONTROL (required, and it must REDDEN): the SAME drive is re-run with
// the confirmation step bypassed (empty echo / another team's id / a cancelled
// confirmation).  The lane's own `assertApprovalHappened` must FAIL on those runs —
// the red run is written to `negative-control/` and to the lane output.  A control
// that cannot fail proves nothing, so the control also asserts that the observation
// DISCRIMINATES: true exactly where the phrase was typed, false where it was not.
//
// NOT-CLAIMED is emitted verbatim in `result.json` (see NOT_CLAIMED below): the
// boundary in arm 1 is a recording double, so arm 1 proves the GATE and the adapter
// forwarding, never that the adopted runtime executed.
//
// PREREQ: absent-dsh-binary dsh-tui "npm i -g @deepseek-harness-tui/dsh-tui@0.10.1"
// PREREQ: absent-runtime tmux "install tmux; the TUI requires a real TTY"
// PREREQ: absent-fixture tui profile in the sandbox root "bun skills/dsh-qa/scripts/tui-mount.mjs --sandbox-root <root> --install"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-team-surface.mjs --self-test
//   bun skills/dsh-qa/scripts/tui-team-surface.mjs [--sandbox-root <dir>] [--no-skip] [--profile-source <warm dshhome>]
// Evidence -> evidence/tui/team-surface-verify/<timestamp>/{result.json,output.log,raw/,negative-control/,panes/}
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  REPO, artifactRevision, emitMarker, gateTuiPrereqs, makeChecks, parseSandboxArgs, profileState,
  readSessionHeaders, runTuiSession,
} from "./lib/tui-lane.mjs"

export const SLUG = "tui-team-surface"
export const TASK = "t3"
/** The scene ids and titles frozen by the contract (§3.1/§3.2). */
export const PLAN_SCENE = { id: "mpd-tui-plan", title: "MPD plan approval" }
export const TEAM_SCENE = { id: "mpd-tui-team", title: "MPD team" }
/** The adopted tools the two mutations must ride (§6.1). */
export const APPROVE_TOOL = "agent_teams_approve"
export const DISCARD_TOOL = "agent_teams_delete"
/** The frozen confirmation phrase is built from the record's OWN id (§4.1). */
export const TEAM_ID = "mpd-fixture-1"
export const TEAM_NAME = "Fixture Team"
export const CAPTAIN_ID = "fixture-captain-session"
/** The instruction line the surface must always render verbatim (§3.2). */
export const INSTRUCTION = "approval needs the exact team id typed below, then Ctrl+X"

export const TUI_DIST = join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js")
export const ADAPTER_DIST = join(REPO, "packages", "mpd-dsh-adapter-plugin", "dist", "index.js")
export const EVIDENCE_ROOT = join(REPO, "evidence", "tui", "team-surface-verify")

// Only the seams this case needs are enabled: the scene + the two entry-point
// registries. Everything else (status line, renderers, settings, shortcuts, dialogs,
// session/decision events) is switched off so the double stays small and honest.
const SCENE_CONFIG = {
  scene: true,
  commands: true,
  commandTrees: true,
  statusLine: false,
  renderers: false,
  settingsSection: false,
  shortcuts: false,
  dialogs: false,
  sessionEvents: false,
  decisionEvents: false,
}

/**
 * What this case does NOT claim. Emitted verbatim in `result.json` so a reader
 * cannot mistake a double for a runtime.
 */
export const NOT_CLAIMED = [
  "ARM 1 does not execute the adopted agent_teams_approve runtime: the harness tool registry is a RECORDING DOUBLE that captures the boundary call (name, arguments, callId, agent) and answers the fixture's own counts. Arm 1 proves the in-scene confirmation GATE, the adapter forwarding of exec.agent, and that the scene reports the tool's own structured result — never that a team was approved by arm 1.",
  "ARM 1 does not drive a real TTY: it renders the registered scene component with a host double (React/ui kit, effects after render, hooks index-keyed). Real keystrokes in a real host are arm 2's claim.",
  "ARM 2 runs the real host with a REAL captain: the fixture's `captainSessionId` is set to the live session id the sandbox boot just produced, so the adopted `requireFreshCaptainTeam` check passes and the approval executes for real. It does NOT claim that this works when the record names a session that is not attached — that case was measured separately (evidence/tui/team-surface-verify/preboot-probe/: the pane refuses loudly with `the captain session <id> is not attached in this process` and the record is untouched).",
  "NO VISIBLE-VERDICT CLAIM, and this one is a MEASURED DEVIATION, not a lane limitation: when an approval COMMITS, the lane claims the RECORD flip and the pane's post-commit state — never that the frozen §4.5 verdict line was rendered. It was NOT rendered (finding F1 below): after the post-call re-read the record is no longer staged, the action block is dropped and the user sees the precondition-failure state instead.",
  "The captain model is not claimed to react to a TUI approval (contract §6.3 / NOT-CLAIMED #T3): the lane asserts the tool's own result and the record, not a subsequent model turn.",
  "No parity claim: equal facts, not equal layout/styling/geometry/localization (contract §7.1).",
  "`alt+t` is not exercised: it is best-effort by contract (§5.3).",
]

// ── pure pieces (all falsifiable from the self-test) ────────────────────────

/** sha256 of a file's bytes. */
export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/**
 * The staged team record this case writes to disk. Shaped like a record the plugin
 * itself writes — the TUI projection reads it back through its own reader, and the
 * ADOPTED runtime re-validates it at its durable boundary (`coerceTeamState` →
 * `isTeamState`: `taskSeq`, member `joinedAt`, task `createdAt`/`updatedAt`), so a
 * hand-written record that skipped those fields would be rejected there and the
 * real approval path would never be reached.
 * @param options.id - the team id (the confirmation phrase is built from it).
 * @param options.captainSessionId - the captain session the record names.
 */
export function stagedRecord({ id = TEAM_ID, captainSessionId = CAPTAIN_ID, name = TEAM_NAME } = {}) {
  const now = Date.now()
  return {
    id,
    name,
    description: "staged fixture written by the tui-team-surface lane",
    captainSessionId,
    createdAt: now - 60_000,
    phase: "staged",
    planReviewState: "awaiting_review",
    taskSeq: 2,
    members: [
      { id: "m1", name: "Architect", role: "architecture review", provider: "deepseek-official", model: "deepseek-v4-flash", joinedAt: now - 55_000, status: "idle" },
      { id: "m2", name: "Senior Engineer", role: "primary implementation", provider: "deepseek-official", model: "deepseek-v4-flash", joinedAt: now - 54_000, status: "idle" },
    ],
    tasks: [
      { id: "t1", kind: "requirements", subject: "freeze the contract", status: "completed", assignee: "Architect", attempt: 1, round: 1, verdict: "pass", dependencies: [], createdAt: now - 50_000, updatedAt: now - 49_000 },
      { id: "t2", kind: "implementation", subject: "build it", status: "pending", assignee: "Senior Engineer", attempt: 0, round: 1, dependencies: ["t1"], createdAt: now - 48_000, updatedAt: now - 48_000 },
    ],
  }
}

/** The confirmation phrase the contract builds from the record's OWN id (§4.1). */
export function approvalPhrase(id = TEAM_ID) {
  return "approve " + id
}

/**
 * Write one team record (and an inbox row) under the SANDBOX workspace.
 * @returns the record dir, the file, and the file's digest (the "no write" witness).
 */
export function writeTeamFixture(workspace, record, { mailbox = true } = {}) {
  const dir = join(workspace, ".mpd", "team", String(record.id))
  mkdirSync(join(dir, "inbox"), { recursive: true })
  const file = join(dir, "team.json")
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n")
  if (mailbox) {
    writeFileSync(join(dir, "inbox", "captain.jsonl"), JSON.stringify({ id: "a", from: "Architect", to: "captain", content: "contract frozen", ts: 1 }) + "\n")
  }
  return { dir, file, sha256: sha256File(file) }
}

/**
 * The lines a reader cares about out of a rendered surface (pure, so the
 * self-test can falsify the parser with a synthetic render).
 */
export function surfaceFacts(text) {
  // Only LEADING whitespace is stripped: a real pane pads rows to the terminal
  // width, and the confirmation echo must be read exactly (a trailing-space strip
  // is applied to the echo alone, never to the line before the prefix is matched).
  const lines = String(text ?? "").split("\n").map((line) => line.trimStart())
  const clean = (line) => line.replace(/\s+$/, "")
  const pick = (predicate) => clean(lines.find(predicate) ?? "")
  const confirmLine = clean(lines.find((line) => line.startsWith("confirm ")) ?? "")
  return {
    titleLine: pick((line) => line.startsWith("MPD plan approval")),
    teamLine: pick((line) => /^team\s/.test(line)),
    instruction: pick((line) => line === INSTRUCTION),
    requiredLine: pick((line) => line.startsWith("required ")),
    requiredPhrase: pick((line) => line.startsWith("required ")).replace(/^required\s+/, ""),
    echoLine: confirmLine,
    confirmEcho: clean(confirmLine.replace(/^confirm\s*/, "")),
    runnableLine: pick((line) => line.startsWith("runnable ")),
    message: clean(lines.filter((line) => /^approved:|^approve failed:|^confirmation does not match|^discarded:|^discard failed:/.test(line)).at(-1) ?? ""),
    emptyState: pick((line) => line.startsWith("no staged plan for team")),
  }
}

/**
 * Reduce one drive to the observable facts.
 *
 * `approvalHappened` is true ONLY on a real call at the harness boundary: the pane
 * text alone can never set it.
 */
export function observe({ text, boundaryCalls }, phrase = approvalPhrase()) {
  const facts = surfaceFacts(text)
  const approveCalls = (boundaryCalls ?? []).filter((call) => call?.name === APPROVE_TOOL)
  return {
    // The rendered bytes the judgement was made from: every claim quotes this.
    text: String(text ?? ""),
    facts,
    phrase,
    boundaryCalls: boundaryCalls ?? [],
    approveCalls,
    approvalAttempts: approveCalls.map((call) => ({
      name: call.name,
      confirmation: call.arguments?.confirmation,
      agentId: call.agent?.id,
      callIdPresent: typeof call.callId === "string" && call.callId.length > 0,
    })),
    approvalHappened: approveCalls.length > 0,
  }
}

/**
 * The assertion the negative control must be able to REDDEN.
 *
 * This is the lane's own check: "an approval happened". It is deliberately a
 * standalone function so the control run evaluates the SAME code as the green run.
 */
export function assertApprovalHappened(observation) {
  if (observation?.approvalHappened !== true) {
    return { pass: false, reason: "no call to " + APPROVE_TOOL + " reached the harness boundary (calls=" + (observation?.approveCalls?.length ?? 0) + ")" }
  }
  return { pass: true, reason: "the harness boundary recorded " + observation.approveCalls.length + " call(s) to " + APPROVE_TOOL }
}

// ── the host double (React/ui kit) ─────────────────────────────────────────

/**
 * A host kit double that models the host instead of being permissive: hooks are
 * index-keyed across renders (the reconciler's hook-order contract), effects run
 * AFTER the render, and `useInput` handlers are captured so a key can be pressed.
 */
export function makeKit(terminal = { columns: 216, rows: 48 }) {
  const store = new Map()
  const handlers = []
  let index = 0
  let pending = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => {
      const key = "state:" + index
      index += 1
      if (!store.has(key)) store.set(key, typeof initial === "function" ? initial() : initial)
      return [store.get(key), (next) => store.set(key, typeof next === "function" ? next(store.get(key)) : next)]
    },
    useEffect: (fn) => {
      const key = "effect:" + index
      index += 1
      if (store.has(key)) return
      store.set(key, true)
      pending.push(fn)
    },
    useRef: (initial) => {
      const key = "ref:" + index
      index += 1
      if (!store.has(key)) store.set(key, { current: initial })
      return store.get(key)
    },
    useSyncExternalStore: () => {},
  }
  const Text = (props) => ({ type: "Text", props, children: [props?.children] })
  const Box = (props) => ({ type: "Box", props, children: [] })
  const ui = {
    Box,
    Text,
    useInput: (handler) => { handlers.push(handler) },
    useTerminalSize: () => terminal,
  }
  return {
    React,
    ui,
    handlers,
    begin: () => { index = 0; handlers.length = 0 },
    flush: () => { const list = pending; pending = []; for (const fn of list) fn(); return list.length > 0 },
    press: (input, key = {}) => {
      const handler = handlers.at(-1)
      if (handler === undefined) throw new Error("no useInput handler was registered by the scene")
      handler(input, key)
    },
    text: (tree) => {
      const out = []
      const walk = (node) => {
        if (node === null || node === undefined) return
        if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return }
        if (Array.isArray(node)) { for (const child of node) walk(child); return }
        if (node.props?.children !== undefined) walk(node.props.children)
        for (const child of node.children ?? []) walk(child)
      }
      walk(tree)
      return out.join("\n")
    },
  }
}

/** Render a scene component until its effects settle. */
export function renderScene(kit, component, props) {
  let tree
  for (let pass = 0; pass < 6; pass += 1) {
    kit.begin()
    tree = component({ React: kit.React, ui: kit.ui, close: () => {}, ...props })
    if (!kit.flush()) break
  }
  return kit.text(tree)
}

// ── arm 1: the bundle's own wiring, driven by captured keystrokes ───────────

/**
 * Mount the REAL built plugin through its REAL `apply()` with a host double and a
 * recording harness tool registry, and return what it registered.
 */
export async function mountBundle({ workspace, home, members = 2, tasks = 2 }) {
  const services = {}
  const sceneRegistrations = []
  const commandRegistrations = []
  const boundaryCalls = []
  const installErrors = []
  const agents = [{ id: CAPTAIN_ID, session: { header: { cwd: workspace } } }]

  const ctx = {
    get: (id) => services[id],
    inject: (deps, callback) => {
      try {
        if (deps.every((dep) => services[dep] !== undefined)) callback({ get: (id) => services[id] })
      } catch (error) {
        installErrors.push("inject(" + deps.join(",") + "): " + String(error?.message ?? error))
      }
      return {}
    },
    on: () => ({ dispose() {} }),
    effect: (fn) => { try { fn() } catch { /* a disposed scope owns no effects */ } },
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  }

  services.tuiScenes = {
    register: (descriptor) => { sceneRegistrations.push({ id: descriptor.id, title: descriptor.title, component: descriptor.component }) },
    open: () => true,
  }
  services.commands = { register: (descriptor) => { commandRegistrations.push(descriptor?.name ?? "?") }, list: () => [] }
  services.tuiCommandTrees = { register: () => ({}), list: () => [] }
  services.agents = { list: () => agents, get: (id) => agents.find((agent) => agent.id === id) }
  services.tools = {
    get: (name) => (name === APPROVE_TOOL || name === DISCARD_TOOL ? { name } : undefined),
    execute: async (exec) => {
      boundaryCalls.push(exec)
      return { value: { status: "running", team_id: exec?.arguments?.confirmation?.replace(/^approve\s+/, "") ?? TEAM_ID, members, tasks } }
    },
  }
  const adapter = (await import(pathToFileURL(ADAPTER_DIST).href))
  services.mpdDsh = adapter.createDshAdapter(ctx)

  const tui = await import(pathToFileURL(TUI_DIST).href)
  let report
  let applyError
  try {
    report = tui.apply(ctx, SCENE_CONFIG)
  } catch (error) {
    applyError = String(error?.message ?? error)
  }
  const byId = new Map(sceneRegistrations.map((entry) => [entry.id, entry]))
  return {
    report,
    applyError,
    installErrors,
    sceneRegistrations,
    commandRegistrations,
    boundaryCalls,
    plan: byId.get(PLAN_SCENE.id),
    team: byId.get(TEAM_SCENE.id),
    adapter,
  }
}

/**
 * Drive one confirmation scenario through the registered plan surface.
 * `mode` is the ONLY difference between the runs, so the control is a true re-run.
 */
export async function drive({ kit, component, mode, phrase = approvalPhrase() }) {
  const props = {}
  let text = renderScene(kit, component, props)
  const atEntry = surfaceFacts(text).confirmEcho
  if (mode === "typed" || mode === "cancelled") {
    for (const character of phrase) {
      renderScene(kit, component, props)
      kit.press(character, {})
    }
    text = renderScene(kit, component, props)
  }
  if (mode === "cancelled") {
    kit.press("", { escape: true })
    text = renderScene(kit, component, props)
  }
  const beforeChord = text
  kit.press("x", { ctrl: true })
  // A REAL timer, never `Atomics.wait`: the tool call is an async chain, and a
  // blocking wait would let it settle only after the render that checks it.
  await new Promise((resolve) => setTimeout(resolve, 60))
  text = renderScene(kit, component, props)
  return { mode, atEntry, beforeChord, afterChord: text }
}

/** Arm 1: one green drive plus the three bypassed drives. */
export async function armBoundary({ workspace, home, outDir }) {
  const mounted = await mountBundle({ workspace, home })
  const items = []
  const add = (id, ok, note, extra = {}) => items.push({ id, ok: ok === true, note, ...extra })
  add("A1-apply", mounted.applyError === undefined && mounted.plan !== undefined,
    mounted.applyError === undefined
      ? "the REAL plugin apply() registered " + mounted.sceneRegistrations.map((entry) => entry.id).join(",")
      : "apply() threw: " + mounted.applyError)
  add("A2-plan-scene", mounted.plan?.id === PLAN_SCENE.id && mounted.plan?.title === PLAN_SCENE.title,
    "registered scene " + JSON.stringify(mounted.plan?.id) + " title " + JSON.stringify(mounted.plan?.title))
  add("A3-entry-points", mounted.commandRegistrations.length > 0,
    "command registrations: " + JSON.stringify(mounted.commandRegistrations))

  const kit = makeKit()
  const green = await drive({ kit, component: mounted.plan.component, mode: "typed" })
  const greenObs = observe({ text: green.afterChord, boundaryCalls: mounted.boundaryCalls })
  const greenTitle = surfaceFacts(green.afterChord)

  add("A4-real-fixture-read", green.afterChord.includes(TEAM_NAME) && greenTitle.teamLine.includes(TEAM_ID),
    "the surface rendered the record on disk: " + greenTitle.teamLine)
  add("A5-confirm-step-requested",
    greenTitle.instruction === INSTRUCTION && greenTitle.requiredPhrase === approvalPhrase() && green.atEntry === "",
    "verbatim instruction present, required phrase " + JSON.stringify(greenTitle.requiredPhrase) + ", echo at entry " + JSON.stringify(green.atEntry))
  add("A6-echo-carries-phrase", surfaceFacts(green.beforeChord).confirmEcho === approvalPhrase(),
    "the echo after typing is " + JSON.stringify(surfaceFacts(green.beforeChord).confirmEcho))

  const greenAssertion = assertApprovalHappened(greenObs)
  const attempt = greenObs.approvalAttempts[0]
  add("A7-approval-attempt", greenAssertion.pass &&
    attempt?.name === APPROVE_TOOL &&
    attempt?.confirmation === approvalPhrase() &&
    attempt?.agentId === CAPTAIN_ID &&
    attempt?.callIdPresent === true,
    "boundary call " + JSON.stringify(attempt) + " (" + greenAssertion.reason + ")")
  add("A8-tool-result-rendered",
    greenObs.facts.message.startsWith("approved: " + TEAM_ID + " running"),
    "the scene rendered the tool's own structured result: " + JSON.stringify(greenObs.facts.message))

  // The three bypassed runs. Each MUST report no approval at the boundary.
  const reds = []
  for (const mode of ["empty", "wrong-id", "cancelled"]) {
    const calls = []
    const kit2 = makeKit()
    const sub = { boundaryCalls: calls, name: mode }
    const phrase = mode === "wrong-id" ? approvalPhrase("some-other-team") : approvalPhrase()
    // A per-run recording boundary: the same component, a fresh call log.
    const original = mounted.boundaryCalls.length
    const run = await drive({ kit: kit2, component: mounted.plan.component, mode: mode === "wrong-id" ? "typed" : mode, phrase })
    sub.calls = mounted.boundaryCalls.slice(original)
    sub.path = run
    reds.push({ mode, observation: observe({ text: run.afterChord, boundaryCalls: sub.calls }), path: run })
  }
  const redAssertions = reds.map((entry) => ({ mode: entry.mode, ...assertApprovalHappened(entry.observation), message: entry.observation.facts.message }))
  add("B1-bypassed-runs-refuse",
    redAssertions.every((entry) => entry.pass === false),
    "every bypassed run failed the approval assertion (the required red): " + JSON.stringify(redAssertions.map((entry) => ({ mode: entry.mode, pass: entry.pass, message: entry.message }))))
  add("B2-gate-is-what-refused",
    reds.every((entry) => entry.observation.facts.message === "confirmation does not match this team"),
    "each bypassed run rendered the phrase-gate refusal: " + JSON.stringify(reds.map((entry) => entry.observation.facts.message)))
  add("B3-observation-discriminates",
    greenObs.approvalHappened === true && reds.every((entry) => entry.observation.approvalHappened === false),
    "approvalHappened true with the phrase typed, false in all " + reds.length + " bypassed runs")

  // The empty-state arm (contract §3.2 precondition): a malformed, a non-staged and
  // an absent record must render the empty state instead of throwing. Each runs in
  // its OWN sandbox workspace, so the healthy fixture is never the thing measured.
  const emptyArms = []
  const emptyCases = [
    {
      name: "malformed-record",
      setup: (ws) => {
        const dir = join(ws, ".mpd", "team", TEAM_ID)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, "team.json"), "{ this is not JSON at all")
      },
    },
    { name: "non-staged-record", setup: (ws) => { writeTeamFixture(ws, { ...stagedRecord(), phase: "running" }) } },
    { name: "absent-record", setup: () => {} },
  ]
  for (const entry of emptyCases) {
    const ws = join(dirname(workspace), "ws-" + entry.name)
    mkdirSync(ws, { recursive: true })
    entry.setup(ws)
    let threw
    let facts
    try {
      const mount = await mountBundle({ workspace: ws, home })
      facts = surfaceFacts(renderScene(makeKit(), mount.plan.component, {}))
    } catch (error) {
      threw = String(error?.message ?? error)
    }
    emptyArms.push({ name: entry.name, threw, facts })
  }
  add("A10-empty-state-no-throw",
    emptyArms.every((entry) => entry.threw === undefined && entry.facts.emptyState.startsWith("no staged plan for team")),
    "malformed / non-staged / absent records each rendered the empty state and threw nothing: " +
    JSON.stringify(emptyArms.map((entry) => ({ name: entry.name, threw: entry.threw, emptyState: entry.facts.emptyState, title: entry.facts.titleLine }))))

  mkdirSync(join(outDir, "negative-control"), { recursive: true })
  const control = {
    note: "the SAME drive and the SAME assertion (`assertApprovalHappened`) with the confirmation step bypassed — this run MUST fail",
    expected: "fail",
    observed: redAssertions.every((entry) => entry.pass === false) ? "fail" : "pass",
    green: { mode: "typed", pass: greenAssertion.pass, reason: greenAssertion.reason, message: greenObs.facts.message },
    reds: redAssertions,
    discriminatingPower: greenObs.approvalHappened === true && reds.every((entry) => entry.observation.approvalHappened === false),
  }
  writeFileSync(join(outDir, "negative-control", "control.json"), JSON.stringify(control, null, 2) + "\n")
  writeFileSync(join(outDir, "negative-control", "control.log"),
    "GREEN run (phrase typed):     pass=" + greenAssertion.pass + " " + greenAssertion.reason + "\n" +
    "  message: " + greenObs.facts.message + "\n" +
    reds.map((entry) => "RED run (" + entry.mode + "):          pass=" + String(assertApprovalHappened(entry.observation).pass) + " " +
      assertApprovalHappened(entry.observation).reason + "\n  message: " + entry.observation.facts.message).join("\n") + "\n")

  return { items, mounted, green: greenObs, reds: reds.map((entry) => ({ mode: entry.mode, observation: entry.observation })), emptyArms, control }
}

// ── arm 2: the real host ───────────────────────────────────────────────────

/** The live session id the sandbox host created for this workspace (or undefined). */
export function liveSessionId(root, workspace) {
  const headers = readSessionHeaders(root).filter((entry) => entry.cwd === workspace)
  if (headers.length === 0) return undefined
  return headers.sort((a, b) => b.mtimeMs - a.mtimeMs)[0].sessionId
}

/**
 * Seed the sandbox profile from a WARM dsh-tui profile (symlink; no network install)
 * and copy the credential/settings files the sandbox needs.
 * @returns which warm root was used, and whether the profile is now present.
 */
export function seedProfile(root, log, explicitSource) {
  const profileDir = join(root, "dshhome", "profiles", "dsh-tui")
  if (existsSync(join(profileDir, "package.json"))) return { source: "already-present", seeded: false }
  for (const candidate of profileSourceCandidates(explicitSource)) {
    const source = join(candidate, "profiles", "dsh-tui")
    if (!existsSync(join(source, "package.json"))) continue
    mkdirSync(join(root, "dshhome", "profiles"), { recursive: true })
    rmSync(profileDir, { recursive: true, force: true })
    symlinkSync(source, profileDir, "junction")
    for (const file of [".credentials.yaml", "settings.yaml"]) {
      const from = join(candidate, file)
      const to = join(root, "dshhome", file)
      if (existsSync(from) && !existsSync(to)) copyFileSync(from, to)
    }
    log("host: dsh-tui profile seeded from " + source.replace(REPO + "/", "") + " (symlink, no install)")
    return { source: source.replace(REPO + "/", ""), seeded: true }
  }
  return { source: undefined, seeded: false }
}

/** The warm dsh-home roots this lane may seed a sandbox profile from, in order. */
export function profileSourceCandidates(explicitSource) {
  return explicitSource === undefined
    ? [join(REPO, ".mpd", "recon", "qa", "dshhome"), join(REPO, ".mpd", "recon", "t9-clean", "dshhome")]
    : [explicitSource]
}

/** Is a `dsh-tui` profile reachable for this root — already installed, or seedable? */
export function profileReachable(root, explicitSource) {
  if (existsSync(join(root, "dshhome", "profiles", "dsh-tui", "package.json"))) return true
  return profileSourceCandidates(explicitSource).some((candidate) => existsSync(join(candidate, "profiles", "dsh-tui", "package.json")))
}

/** Is an executable on PATH? (a POSITIVE probe — the gate never catches a failure). */
export function binaryOnPath(name) {
  const probe = spawnSync("which", [name], { encoding: "utf8", timeout: 10_000 })
  return probe.status === 0 && String(probe.stdout ?? "").trim() !== ""
}

/**
 * The declared prerequisites of the REAL lane, in check order (the skill's grammar:
 * `[mpd-qa] SKIP|FAIL` must be the FIRST stdout line, so this gate runs before any
 * output and a skip is never followed by a PASS).
 */
export function hostPrereqs(root, explicitSource) {
  return [
    { code: "absent-dsh-binary", probe: "dsh-tui", remedy: "npm i -g @deepseek-harness-tui/dsh-tui@0.10.1", present: () => binaryOnPath("dsh-tui") },
    { code: "absent-runtime", probe: "tmux", remedy: "apt-get install tmux (a real TTY is required; stdout must not be a pipe)", present: () => binaryOnPath("tmux") },
    { code: "absent-fixture", probe: "a dsh-tui profile in the sandbox root (or a warm source to seed one from)", remedy: "bun skills/dsh-qa/scripts/tui-mount.mjs --sandbox-root <root> --install", present: () => profileReachable(root, explicitSource) },
  ]
}

/** Arm 2: boot the real TUI, drive the real keystrokes, and judge pane against record. */
export async function armHost({ root, outDir, log, profileSource }) {
  const workspace = join(root, "ws")
  mkdirSync(workspace, { recursive: true })
  const seeded = seedProfile(root, log, profileSource)
  const state = profileState(root)
  const present = state.present && state.hasHost && state.hasBundle
  if (!present) {
    return {
      skipped: true,
      reason: "no dsh-tui profile in the sandbox root (" + root.replace(REPO + "/", "") + ")",
      seeded,
      profileState: { present: state.present, hasHost: state.hasHost, hasBundle: state.hasBundle },
    }
  }

  // The record exists BEFORE the surface opens, so the scene reads it from disk.
  writeTeamFixture(workspace, stagedRecord({ captainSessionId: "sess-not-yet-attached" }))
  const phrase = approvalPhrase()
  const steps = [
    {
      name: "plan-open",
      before: () => {
        const id = liveSessionId(root, workspace)
        const fixture = writeTeamFixture(workspace, stagedRecord({ captainSessionId: id ?? "unresolved-live-session" }))
        log("host: fixture captainSessionId := " + JSON.stringify(id ?? null) + " (record " + fixture.sha256.slice(0, 12) + ")")
      },
      keys: ["/mpd plan", "Enter"],
      waitMs: 9000,
    },
    { name: "phrase-typed", keys: [phrase], waitMs: 2500 },
    { name: "approve-attempt", keys: ["C-x"], waitMs: 9000 },
    // The picker dialog is driven LAST and in its own capture: a managed select owns
    // the keyboard while it is up, so a dialog opened before the approval drive could
    // swallow the command (measured: `/mpd plan` landed in the open picker and the
    // BOARD opened instead of the plan surface). The approval drive must never depend
    // on dialog interaction.
    { name: "scene-closed", keys: ["Escape"], waitMs: 3000 },
    { name: "picker-open", keys: ["/mpd", "Enter"], waitMs: 7000 },
  ]
  const session = runTuiSession({ lane: SLUG, root, outDir: join(outDir, "panes"), steps, bootWaitMs: 120_000 })
  for (const failure of session.failures) log("host: tmux " + failure)
  const pane = (name) => session.panes.find((entry) => entry.name === name)?.text ?? ""
  const recordFile = join(workspace, ".mpd", "team", TEAM_ID, "team.json")
  const record = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, "utf8")) : undefined
  const approvedPane = pane("approve-attempt")
  const refusalLine = approvedPane.split("\n").map((line) => line.trim()).find((line) => line.startsWith("approve failed:")) ?? ""
  const approvedLine = approvedPane.split("\n").map((line) => line.trim()).find((line) => line.startsWith("approved:")) ?? ""
  const paneFacts = surfaceFacts(approvedPane)
  // The plugin's OWN pre-gates refuse before any tool runs; the adopted runtime is
  // the only source of a validator/authorization message. Which one spoke is the
  // difference between "the seam chain was reached" and "the composer said no".
  const preGateRefusal = /is not registered in this composition|is not attached in this process|no live session is attached/.test(refusalLine)
  const refusalFromAdoptedRuntime = refusalLine !== "" && !preGateRefusal
  // THE RECORD IS THE TRUTH SOURCE. Only the adopted `approveStagedTeam` writes this
  // signature: phase "running" + `approvedAt` + `planReviewState` DELETED. A pane can
  // lie; this cannot be produced by the TUI package (no write primitive).
  const recordApproved = record?.phase === "running" && typeof record?.approvedAt === "number"
  const recordSignature = recordApproved && record?.planReviewState === undefined
  const postCommitEmptyState = recordApproved && paneFacts.emptyState !== ""
  const outcomeClass = recordApproved
    ? (approvedLine === "" ? "approved-by-the-adopted-runtime/verdict-NOT-visible-after-commit" : "approved-by-the-adopted-runtime/verdict-visible")
    : refusalFromAdoptedRuntime
      ? "refused-by-the-adopted-runtime"
      : refusalLine !== ""
        ? "refused-by-the-plugin-pre-gate"
        : "no-outcome-line"

  const findings = []
  if (recordApproved && approvedLine === "") {
    findings.push({
      id: "F1-approval-verdict-not-visible",
      severity: "medium",
      problem: "The approval COMMITTED for real (record: phase staged→running, approvedAt set, planReviewState DELETED) but the surface never rendered the frozen §4.5 verdict line `approved: <teamId> running · members <n> · tasks <n>`: the approve path sets that message, then its `finally` re-reads the record — which is no longer staged — so `usable` is false and the whole action block (the only place the message is rendered) is dropped. What the user sees after a SUCCESSFUL approval is `MPD plan approval — no staged plan for team mpd-fixture-1 (phase running)` + `esc back`, which reads as 'nothing to approve' rather than 'approved'. §4.5 row 1 and §4.2 barrier 5 ('after it settles the record is re-read and the verdict is rendered') both promise the verdict.",
      requiredFix: "Render the last verdict (or a one-line `approved: <id> running · members <n> · tasks <n>` banner) in the non-usable branch of the plan scene, so a committed approval is confirmed on screen. Owner: t2 (packages/mpd-tui-plugin/src/scenes.ts, out of this lane's scope).",
      evidence: "panes/approve-attempt.pane.txt (only the post-commit empty state) vs the record flip in result.json arm2.record",
    })
  }

  const items = []
  const add = (id, ok, note, extra = {}) => items.push({ id, ok: ok === true, note, ...extra })
  add("H1-host-renders-surface", /MPD plan approval/.test(pane("plan-open")) && pane("plan-open").includes(TEAM_ID),
    "the real host rendered the plan surface for the sandbox record: " + (pane("plan-open").split("\n").map((l) => l.trim()).find((l) => l.startsWith("MPD plan approval")) ?? "(no title line)"))
  add("H2-host-dialog-request", /Plan/.test(pane("picker-open")) && /review and approve a staged plan/.test(pane("picker-open")),
    "the bare /mpd managed dialog listed the Plan entry: " + (pane("picker-open").split("\n").map((l) => l.trim()).filter((l) => /Plan|approve a staged plan/.test(l)).slice(0, 3).join(" | ") || "(nothing)"))
  add("H3-host-confirm-step", pane("plan-open").includes(INSTRUCTION) && pane("phrase-typed").includes("confirm    " + phrase),
    "the host rendered the confirmation step and echoed the typed phrase")
  add("H4-real-mutation-via-the-adopted-runtime", recordSignature,
    recordApproved
      ? "the RECORD was committed by the adopted runtime (phase=" + JSON.stringify(record?.phase) + ", approvedAt=" + record?.approvedAt + ", planReviewState=" + JSON.stringify(record?.planReviewState) + " DELETED — a signature only approveStagedTeam writes); pane outcome: " + outcomeClass
      : "no approval committed: phase=" + JSON.stringify(record?.phase) + " approvedAt=" + JSON.stringify(record?.approvedAt) + "; pane outcome: " + outcomeClass)
  add("H4b-outcome-reported-honestly",
    recordApproved ? refusalLine === "" : (refusalLine !== "" || postCommitEmptyState === false),
    recordApproved
      ? "the pane did not deny an approval that committed (verdict line " + JSON.stringify(approvedLine) + ", post-commit empty state " + String(postCommitEmptyState) + ")"
      : "no approval committed and the pane said so: " + JSON.stringify(refusalLine || paneFacts.emptyState))
  add("H5-pane-and-record-agree",
    recordApproved
      ? (approvedLine !== "" || postCommitEmptyState) && refusalLine === ""
      : approvedLine === "",
    "pane claims approved=" + String(approvedLine !== "") + ", refusal=" + String(refusalLine !== "") + ", post-commit empty state=" + String(postCommitEmptyState) + "; record phase=" + JSON.stringify(record?.phase) + " approvedAt=" + JSON.stringify(record?.approvedAt))
  add("H6-real-keystroke-drive", session.panes.length >= steps.length,
    "tmux captured " + session.panes.length + " panes for " + steps.length + " driven steps (real keystrokes)")

  return {
    skipped: false,
    seeded,
    sandboxRoot: root,
    workspace,
    steps: steps.map((entry) => ({ name: entry.name, keys: entry.keys, waitMs: entry.waitMs })),
    failures: session.failures,
    record: record === undefined ? undefined : { phase: record.phase, approvedAt: record.approvedAt, captainSessionId: record.captainSessionId, planReviewState: record.planReviewState },
    recordSignature,
    outcome: outcomeClass,
    outcomeLines: { approved: approvedLine, refusal: refusalLine, preGateRefusal, postCommitEmptyState },
    findings,
    panes: session.panes.map((entry) => ({
      name: entry.name,
      chars: entry.text.length,
      facts: surfaceFacts(entry.text),
    })),
    items,
  }
}

// ── the lane entry points ──────────────────────────────────────────────────

function selfTest() {
  const { check, problems } = makeChecks()

  const record = stagedRecord()
  check(record.phase === "staged" && record.planReviewState === "awaiting_review", "the fixture must be a staged record")
  check(record.members.length === 2 && record.tasks.length === 2, "the fixture must carry a runnable roster and graph")
  check(approvalPhrase() === "approve mpd-fixture-1", "the phrase is built from the record id")

  const kit = makeKit()
  check(typeof kit.React.createElement === "function" && typeof kit.ui.useInput === "function", "the host double must model React + the ui kit")
  kit.ui.useInput(() => {})
  check(kit.handlers.length === 1, "useInput handlers must be captured so a key can be pressed")
  check(renderScene(makeKit(), () => null, {}) === "", "a component without the host kit renders an empty tree instead of throwing")

  // The parser, against a synthetic render.
  const rendered = [
    "MPD plan approval — Fixture Team",
    "team       Fixture Team (mpd-fixture-1) · phase staged · review awaiting_review",
    INSTRUCTION,
    "confirm    ",
    "required   approve mpd-fixture-1",
    "runnable   yes",
  ].join("\n")
  const facts = surfaceFacts(rendered)
  check(facts.instruction === INSTRUCTION, "the parser must find the verbatim instruction line")
  check(facts.requiredPhrase === "approve mpd-fixture-1", "the parser must read the required phrase")
  check(facts.confirmEcho === "", "the entry echo must read as EMPTY (no prefill)")
  check(surfaceFacts(rendered.replace("confirm    ", "confirm    approve mpd-fixture-1")).confirmEcho === "approve mpd-fixture-1", "the parser must read a typed echo")

  // The assertion the control relies on must be falsifiable BOTH ways.
  const greenObs = observe({ text: rendered, boundaryCalls: [{ name: APPROVE_TOOL, arguments: { confirmation: approvalPhrase() }, agent: { id: CAPTAIN_ID }, callId: "c1" }] })
  const redObs = observe({ text: rendered.replace("confirm    approve", "confirm    x"), boundaryCalls: [] })
  check(assertApprovalHappened(greenObs).pass === true, "a boundary call must satisfy the approval assertion")
  check(assertApprovalHappened(redObs).pass === false, "an EMPTY boundary must fail the approval assertion (this is the red the control needs)")
  check(greenObs.approvalAttempts[0].agentId === CAPTAIN_ID, "the observation must carry the calling agent's identity")
  check(greenObs.approvalAttempts[0].confirmation === approvalPhrase(), "the observation must carry the exact confirmation text")

  // A purely vacuous observation must NOT be able to pass: text alone never counts.
  check(observe({ text: rendered.replace("confirm    ", "confirm    approve mpd-fixture-1"), boundaryCalls: [] }).approvalHappened === false,
    "pane text alone must never set approvalHappened")

  // The dist really carries the two scene ids, and the package never writes state.
  const dist = readFileSync(TUI_DIST, "utf8")
  check(dist.includes(PLAN_SCENE.id) && dist.includes(TEAM_SCENE.id), "the built dist must carry both scene ids")
  check(!/writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|cpSync|createWriteStream/.test(dist), "the built dist must carry no filesystem write primitive")
  check(existsSync(ADAPTER_DIST), "the adapter dist must be built")

  // The real lane's prerequisite gate: declared in check order, positively probed, and
  // it must report a root with no profile and no warm source as `absent-fixture`.
  const prereqs = hostPrereqs(join(REPO, ".mpd", "recon", "qa", "tui-lanes", "tui-team-surface"), undefined)
  check(prereqs.map((entry) => entry.code).join(",") === "absent-dsh-binary,absent-runtime,absent-fixture",
    "the real lane must declare its three prerequisites in check order")
  check(prereqs.every((entry) => typeof entry.present === "function" && typeof entry.remedy === "string"),
    "every prerequisite must carry a positive probe and a remedy")
  const bare = hostPrereqs(join(REPO, "no-such-root"), "/nonexistent-warm-source")
  check(bare.find((entry) => entry.code === "absent-fixture").present() === false,
    "a root with no profile and no warm source must report absent-fixture")
  check(binaryOnPath("definitely-not-a-binary-xyz") === false && typeof binaryOnPath("node") === "boolean",
    "the PATH probe must be positive-only")

  const skill = join(REPO, "skills", "dsh-qa", "SKILL.md")
  check(existsSync(skill) && readFileSync(skill, "utf8").includes("| " + SLUG + " |"), "the case table must list " + SLUG)

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: fixture, parser, assertion falsifiability and the dist invariants all hold")
}

async function real() {
  const argv = process.argv.slice(2)
  const sourceIndex = argv.indexOf("--profile-source")
  const profileSource = sourceIndex === -1 ? undefined : argv[sourceIndex + 1]
  const { root } = parseSandboxArgs(argv, SLUG)
  // THE PREREQUISITE GATE RUNS FIRST AND PRINTS FIRST: the skill's marker grammar
  // requires exactly one `[mpd-qa] SKIP|FAIL` line, as the FIRST stdout line of the
  // case, and a skipped case must never be followed by a PASS — so nothing at all is
  // emitted (and no evidence directory is created) before this gate clears.
  gateTuiPrereqs(SLUG, hostPrereqs(root, profileSource))
  const stamp = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(EVIDENCE_ROOT, stamp)
  mkdirSync(join(outDir, "raw"), { recursive: true })
  const log = []
  const say = (line) => { log.push(line); console.log("[" + SLUG + "] " + line) }
  const revisionBefore = artifactRevision()
  // HARD non-interference assertions: the frozen contract and the vendor lock must be
  // byte-identical after the run. The workspace's OWN live team record is NOT one of
  // them: this lane runs inside a live team, so that file legitimately mutates while
  // the lane works (attempts, verdicts, mailbox). It is recorded as an OBSERVATION,
  // and the lane never writes it — proven by the fixture digest (A9) and by the built
  // package carrying no write primitive.
  const hardPaths = [join(REPO, ".mpd", "plans", "tui-team-surface.md"), join(REPO, "VENDOR_LOCK.json")]
  const observedPaths = [join(REPO, ".mpd", "team", "mpd-default-8d65a2b2", "team.json")]
  const digest = (paths) => paths.map((path) => ({ path: path.replace(REPO + "/", ""), sha256: existsSync(path) ? sha256File(path) : undefined }))
  const protectedBefore = digest(hardPaths)
  const observedBefore = digest(observedPaths)

  const workspace = root.endsWith("/ws") ? root : join(root, "ws")
  mkdirSync(workspace, { recursive: true })
  const fixture = writeTeamFixture(workspace, stagedRecord())
  say("fixture written to " + fixture.file.replace(REPO + "/", "") + " (sha256 " + fixture.sha256.slice(0, 12) + ")")

  const arm1 = await armBoundary({ workspace, home: join(root, "home"), outDir })
  for (const item of arm1.items) say("arm1 " + item.id + " " + (item.ok ? "ok" : "FAIL") + " — " + item.note)
  // The TUI must not write team state: the fixture digest is the witness.
  const fixtureAfter = sha256File(fixture.file)
  const noWrite = fixtureAfter === fixture.sha256
  arm1.items.push({ id: "A9-no-write-primitive-in-own-code", ok: noWrite, note: "the fixture file is unchanged after every drive (sha256 " + fixtureAfter.slice(0, 12) + ")" })
  say("arm1 A9-no-write-primitive-in-own-code " + (noWrite ? "ok" : "FAIL") + " — fixture sha256 " + (noWrite ? "unchanged" : "CHANGED"))

  writeFileSync(join(outDir, "raw", "arm1-surfaces.json"), JSON.stringify({
    registered: arm1.mounted.sceneRegistrations.map((entry) => ({ id: entry.id, title: entry.title })),
    commands: arm1.mounted.commandRegistrations,
    applyError: arm1.mounted.applyError,
    installErrors: arm1.mounted.installErrors,
    green: { message: arm1.green.facts.message, attempts: arm1.green.approvalAttempts, facts: arm1.green.facts },
    reds: arm1.reds.map((entry) => ({ mode: entry.mode, message: entry.observation.facts.message, attempts: entry.observation.approvalAttempts, facts: entry.observation.facts })),
    emptyArms: arm1.emptyArms,
  }, null, 2) + "\n")
  // The RAW rendered surfaces: the notes quote them, so the bytes behind every
  // arm-1 claim are on disk.
  writeFileSync(join(outDir, "raw", "arm1-green.txt"), arm1.green.text + "\n")
  for (const entry of arm1.reds) {
    writeFileSync(join(outDir, "raw", "arm1-red-" + entry.mode + ".txt"), entry.observation.text + "\n")
  }

  const arm2 = await armHost({ root, outDir, log: say, profileSource })
  if (arm2.skipped) say("arm2 SKIPPED — " + arm2.reason)
  else for (const item of arm2.items) say("arm2 " + item.id + " " + (item.ok ? "ok" : "FAIL") + " — " + item.note)
  // A finding is REPORTED, never hidden and never auto-fixed (packages/ is out of this
  // lane's scope). It does not fail the lane: the lane's subject is whether the gate
  // holds and whether the mutation really happens, and it does.
  const findings = arm2.skipped === true ? [] : (arm2.findings ?? [])
  for (const finding of findings) {
    say("FINDING " + finding.id + " severity=" + finding.severity + " — " + finding.problem + " REQUIRED FIX: " + finding.requiredFix)
  }
  writeFileSync(join(outDir, "raw", "findings.json"), JSON.stringify({
    note: findings.length === 0 ? "no findings from this lane's own evidence" : "findings measured by the lane; the owner repairs, this lane does not",
    findings,
  }, null, 2) + "\n")

  const protectedAfter = digest(hardPaths)
  const observedAfter = digest(observedPaths)
  const interfered = protectedBefore.filter((entry, index) => entry.sha256 !== protectedAfter[index].sha256)
    .map((entry) => entry.path)
  const observedChanged = observedBefore.filter((entry, index) => entry.sha256 !== observedAfter[index].sha256)
    .map((entry) => entry.path)
  say("non-interference: contract + VENDOR_LOCK unchanged=" + String(interfered.length === 0) + (interfered.length > 0 ? " CHANGED: " + interfered.join(",") : ""))
  say("observation: the workspace's OWN live team record changed during the run=" + String(observedChanged.length > 0) +
    (observedChanged.length > 0 ? " (" + observedChanged.join(",") + ") — this lane runs INSIDE a live team, so its own record legitimately mutates; the lane never writes it (A9 + no write primitive in the built package)" : ""))

  const revisionAfter = artifactRevision()
  const revisionDelta = revisionBefore.sha256 === revisionAfter.sha256
    ? { changed: false, reason: "the dist did not move during the run" }
    : { changed: true, reason: "the dist changed mid-run: results describe neither revision", before: revisionBefore.sha256, after: revisionAfter.sha256 }
  if (revisionDelta.changed) say("REVISION DRIFT: " + revisionDelta.reason)

  const arm1Ok = arm1.items.every((item) => item.ok === true)
  const arm2Ok = arm2.skipped === true || arm2.items.every((item) => item.ok === true)
  const strict = process.argv.includes("--no-skip")
  const skippedHost = arm2.skipped === true
  const ok = arm1Ok && arm2Ok && !revisionDelta.changed && interfered.length === 0 && !(skippedHost && strict)

  const payload = {
    task: TASK,
    ok,
    laneScript: {
      path: "skills/dsh-qa/scripts/tui-team-surface.mjs",
      sha256: sha256File(fileURLToPath(import.meta.url)),
      note: "the digest of the lane that produced this result, so the verdict can be tied to the exact bytes that measured it",
    },
    revision: revisionAfter,
    revisionDelta,
    sandboxRoot: root.replace(REPO + "/", ""),
    sandboxNote: "QA scratch under the lane's standard root (AGENTS.md §7: workspace state must be sandboxed; .mpd/ is gitignored so no credential or scratch byte can be committed). The frozen contract and VENDOR_LOCK.json are hard-asserted unchanged; the workspace's own LIVE team record legitimately mutates while this lane runs and is recorded as an observation only.",
    protectedPaths: { before: protectedBefore, after: protectedAfter, changed: interfered },
    observedPaths: { note: "the lane runs INSIDE a live team, so this record mutates as the team works; the lane never writes it", before: observedBefore, after: observedAfter, changed: observedChanged },
    fixture: { file: fixture.file.replace(REPO + "/", ""), sha256Before: fixture.sha256, sha256After: fixtureAfter, unchanged: noWrite },
    arm1: {
      items: arm1.items,
      registered: arm1.mounted.sceneRegistrations.map((entry) => ({ id: entry.id, title: entry.title })),
      emptyStateArms: arm1.emptyArms.map((entry) => ({ name: entry.name, threw: entry.threw, emptyState: entry.facts.emptyState, title: entry.facts.titleLine })),
      boundaryCalls: arm1.green.approvalAttempts,
    },
    arm2,
    negativeControl: arm1.control,
    findings,
    notClaimed: NOT_CLAIMED,
    confirmStepInterpretation: "The frozen contract has NO host dialog for approve (§3.2/§4.2): the confirmation step is the in-scene echo + exact phrase + Ctrl+X chord. `confirm dialog request` is therefore asserted as that step (instruction line, required phrase, EMPTY echo at entry) plus the REAL managed dialog of the bare `/mpd` picker that carries the Plan entry (arm 2, H2).",
  }
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ slug: SLUG, ...payload }, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), log.join("\n") + "\n")

  if (skippedHost) {
    emitMarker(strict ? "FAIL" : "SKIP", SLUG, "absent-fixture", "tui profile in the sandbox root", "bun skills/dsh-qa/scripts/tui-mount.mjs --sandbox-root <root> --install")
  }
  console.log("[" + SLUG + "] " + (ok ? "PASS" : "FAIL") + " -> " + outDir.replace(REPO + "/", ""))
  if (!ok) {
    const failed = [...arm1.items, ...(arm2.items ?? [])].filter((item) => item.ok !== true)
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify(failed).slice(0, 1500))
    process.exit(1)
  }
  console.log("[" + SLUG + "] PASS: arm1 gate+adapter green, negative control red as required, arm2=" + (skippedHost ? "SKIPPED" : arm2.outcome))
  // The scene's 2000 ms refresh interval is real: exit explicitly so a live handle
  // cannot hold the process open after the verdict is written.
  process.exit(0)
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest()
  else real().catch((error) => {
    console.error("[" + SLUG + "] FAIL: " + String(error?.stack ?? error))
    process.exit(1)
  })
}
