#!/usr/bin/env node
// Case team-watchdog-boot — the REAL-dsh boot lane for the team watchdog.
//
// WHY THIS LANE EXISTS (the wave's most severe defect, measured 2026-09-16): the watchdog's
// `agent/pre-step` listener was written `(payload) => this.stamp("step", …)`. `agent/pre-step`
// is a CORDIS WATERFALL: a listener that returns without calling `next()` VETOES the rest of the
// chain and its own return value BECOMES the step decision. The stamp (an object with no
// `messages`) replaced `{kind:'enter', messages}`, so EVERY turn of EVERY mpd session in the
// process died ≈120 ms after `turn/start`, before the model call, with
// `Cannot read properties of undefined (reading 'map'|'findLastIndex'|'length')`.
//
// Every other `team-watchdog-*.mjs` lane drives the BUILT MODULES in-process and never spawns a
// real `dsh`, so no lane exercised a harness turn with the row mounted. This one does: it boots
// a REAL dev-web dsh in a sandbox (bundles base + web-app + the bundle under test), creates a
// session on `agentPreset: "mpd"`, sends one prompt, and reads the verdict from the HARNESS's own
// session log (the concatenated-zstd store, via `lib/session-evidence.mjs` — never from prose).
//
// THREE OUTCOMES, distinguished and asserted (never narrated):
//   * `completed`   — at least one turn/end with an assistant message: the full round trip works.
//   * `model-error` — a turn/end whose reason is a MODEL-level error (missing credential, provider
//                     failure). The turn REACHED the model call, so the pre-step veto is gone:
//                     PASSED FOR THIS INVARIANT, and explicitly NOT a completed turn.
//   * `veto`        — a turn/end carrying the veto signature: FAIL. This is the defect.
//   * `no-turn`     — no turn/end at all: FAIL (the machinery did not survive the row, or the
//                     prompt never reached the loop).
//
// HEAVY: the real run spawns `dsh` and makes a live model call (tens of seconds). Only the offline
// `--self-test` is part of the swept `bun run test:qa`; the real run is a deliberate, manual case.
//
// Usage:
//   bun skills/dsh-qa/scripts/team-watchdog-boot.mjs --self-test     # offline, fast, no dsh
//   bun skills/dsh-qa/scripts/team-watchdog-boot.mjs [--out <dir>]   # REAL boot (heavy)
// Evidence -> evidence/team-watchdog/boot/<timestamp>/{result.json,output.log,raw/boot.log}
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { createServer } from "node:net"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { decodeSessionLog } from "./lib/session-evidence.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..")
const SLUG = "team-watchdog-boot"
/** The row's own apply line (watchdog package §index.ts `warn(...)`). */
const ROW_MARKER = /\[mpd-team-watchdog\] applied:\s*enabled=(\w+).*disposers=(\d+)\s*holdService=(\w+)/
/** The defect's signature, as the harness recorded it. */
const VETO = /Cannot read properties of undefined \(reading '(map|findLastIndex|length)'\)/
/** Model-level failures that still prove the turn reached the model call. */
const MODEL_ERROR = /MISSING_CREDENTIAL|no API key|provider route|ECONNREFUSED|ETIMEDOUT|fetch failed|rate limit|insufficient/i
const PROMPT = "Reply with exactly: watchdog-pre-step-ok"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─────────────────────────────── the evaluator (pure) ───────────────────────────────
/**
 * Everything this lane decides comes from the boot log + the harness's session log.
 *
 * @param observed - `{ rowLine, preset, createOk, promptAccepted, turnEnds, assistantMessages, copied }`.
 * @returns `{ ok, outcome, reason, checks }`.
 */
export function evaluate(observed) {
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })

  const row = ROW_MARKER.exec(String(observed.rowLine ?? ""))
  add("B1", row !== null && row[1] === "true" && Number(row[2]) >= 1 && row[3] === "mpdWatchdog",
    "the watchdog row APPLIED in the real boot (" + (row === null ? "no apply line found" : JSON.stringify({ enabled: row[1], disposers: Number(row[2]), holdService: row[3] })) + ")")
  add("B2", observed.preset === "mpd", "the session was created on agentPreset mpd (" + JSON.stringify(observed.preset) + ")")
  add("B3", observed.createOk === true && observed.promptAccepted === true,
    "session/create and session/prompt were both accepted (" + JSON.stringify({ create: observed.createOk, prompt: observed.promptAccepted }) + ")")
  add("B4", Array.isArray(observed.copied) && observed.copied.includes("settings.yaml") === (observed.settingsPresent === true),
    "the sandbox home received BOTH `.credentials.yaml` and `settings.yaml` when present (" + JSON.stringify(observed.copied) + ")")

  const turnEnds = Array.isArray(observed.turnEnds) ? observed.turnEnds : []
  const vetoLines = turnEnds.filter((line) => VETO.test(String(line)))
  add("B5", turnEnds.length >= 1, "the harness's own session log recorded at least one turn/end (" + turnEnds.length + " turn/end line(s))")
  add("B6", vetoLines.length === 0,
    vetoLines.length === 0 ? "NO turn/end carries the pre-step veto signature (map/findLastIndex/length)" : "VETO: " + String(vetoLines[0]).slice(0, 240))

  let outcome = "no-turn"
  let reason = "no turn/end was recorded — the machinery did not survive the row, or the prompt never reached the loop"
  if (turnEnds.length >= 1) {
    if (vetoLines.length > 0) {
      outcome = "veto"
      reason = VETO.exec(String(vetoLines[0]))[0]
    } else if ((observed.assistantMessages ?? []).length >= 1) {
      outcome = "completed"
      reason = "a turn/end plus an assistant message: the full round trip works"
    } else {
      const errored = turnEnds.map((line) => /"reason":\{"kind":"error","error":\{"message":"([^"]*)"/.exec(String(line))?.[1] ?? "").filter((text) => text !== "")
      const modelLevel = errored.find((text) => MODEL_ERROR.test(text))
      if (modelLevel !== undefined) {
        outcome = "model-error"
        reason = "the turn reached the MODEL call and failed there (not at pre-step): " + modelLevel.slice(0, 200)
      } else {
        outcome = "no-turn"
        reason = errored.length > 0 ? "an UNCLASSIFIED error turn/end (neither the veto nor a model-level failure): " + errored[0].slice(0, 200) : "turn/end recorded with neither an assistant message nor a recognisable reason"
      }
    }
  }
  add("B7", outcome === "completed" || outcome === "model-error",
    outcome === "completed" ? "outcome=completed — the full round trip is witnessed"
      : outcome === "model-error" ? "outcome=model-error — PASSED FOR THIS INVARIANT (the pre-step veto is gone; the turn reached the model call) and explicitly NOT a completed turn: " + reason.slice(0, 160)
        : "outcome=" + outcome + " — " + reason.slice(0, 200))
  return { ok: checks.every((check) => check.ok), outcome, reason, checks }
}

// ─────────────────────────────── the real run (heavy) ───────────────────────────────
function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      probe.close(() => resolvePort(typeof address === "object" && address !== null ? address.port : 0))
    })
  })
}

function makeSandbox() {
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-wdboot-"))
  const home = join(sandbox, "home")
  const profile = join(home, "profiles", "w")
  const userHome = join(sandbox, "userhome")
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  const copied = []
  for (const name of [".credentials.yaml", ".anonymous-user-id", "settings.yaml"]) {
    const src = join(homedir(), ".dsh", name)
    if (existsSync(src)) { cpSync(src, join(home, name)); copied.push(name) }
  }
  // Dev-flavor install: the checkout IS @mpd-dsh/mpd, linked into the sandbox profile.
  symlinkSync(REPO, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-w", private: true, dependencies: {},
    dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
  }, null, 2))
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  return { sandbox, home, ws, copied, env: { ...process.env, DSH_HOME: home, HOME: userHome } }
}

/** Every turn/end + assistant/message line of every session log under one sandbox home. */
function readSessionLines(home) {
  const lines = []
  const root = join(home, "sessions")
  if (!existsSync(root)) return lines
  for (const key of readdirSync(root)) {
    for (const id of readdirSync(join(root, key))) {
      const dir = join(root, key, id)
      let names = []
      try { names = readdirSync(dir) } catch { continue }
      for (const name of names) {
        if (!/^session\..*jsonl(\.zstd)?$/.test(name)) continue
        try {
          for (const line of decodeSessionLog(join(dir, name)).text.split("\n")) {
            if (line.includes('"turn/end"') || line.includes('"assistant/message"')) lines.push(line)
          }
        } catch { /* a session log that cannot be decoded is reported by the turn count */ }
      }
    }
  }
  return lines
}

async function runReal(argv) {
  const at = argv.indexOf("--out")
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
  const dir = at >= 0 && argv[at + 1] ? resolve(argv[at + 1]) : join(REPO, "evidence/team-watchdog/boot", stamp)
  mkdirSync(join(dir, "raw"), { recursive: true })
  const s = makeSandbox()
  const port = await freePort()
  const logPath = join(dir, "raw", "boot.log")
  const fd = openSync(logPath, "w")
  const child = spawn("dsh", ["--profile", "w", "--port", String(port), "--no-open"], { env: s.env, cwd: s.ws, stdio: ["ignore", fd, fd] })
  const readLog = () => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  const out = (text) => { console.log("[" + SLUG + "] " + text) }

  let token = ""
  let cookie = ""
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await sleep(1200)
    const match = /token=([A-Za-z0-9_-]+)/.exec(readLog())
    if (match) token = match[1]
    if (token === "") continue
    try {
      const auth = await fetch(`http://127.0.0.1:${port}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(6000) })
      cookie = (auth.headers.getSetCookie?.() ?? []).map((value) => String(value).split(";")[0]).join("; ") || cookie
      break
    } catch { /* retry until the deadline */ }
  }
  const rpc = async (method, payload, timeout = 60_000) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ type: "client-request", rpcId: randomUUID(), method, payload }),
      signal: AbortSignal.timeout(timeout),
    })
    return { status: res.status, body: await res.text() }
  }

  const created = await rpc("session/create", { args: { request: { cwd: s.ws, agentPreset: "mpd" } } })
  const sessionId = (() => { try { return JSON.parse(created.body)?.result?.value?.sessionId ?? "" } catch { return "" } })()
  const preset = (() => { try { return JSON.parse(created.body)?.result?.value?.agentPreset ?? (/\"agentPreset\":\"([^\"]+)\"/.exec(created.body)?.[1] ?? null) } catch { return null } })()
  const prompt = sessionId === "" ? null : await rpc("session/prompt", { args: { request: { requestId: randomUUID(), sessionId, mode: "queue", content: [{ type: "text", text: PROMPT }] } } })
  out("boot=" + String(/dsh web: http[^\s]*/.exec(readLog())?.[0]?.replace(/token=.*/, "token=<redacted>")) + " session=" + (sessionId === "" ? "NONE" : sessionId) + " preset=" + String(preset))

  // Let the turn settle (a live model call takes seconds; the veto fires in ~120 ms).
  let lines = []
  const settle = Date.now() + 150_000
  while (Date.now() < settle) {
    await sleep(3000)
    lines = readSessionLines(s.home)
    if (lines.some((line) => line.includes('"turn/end"'))) break
  }
  child.kill("SIGKILL")
  await sleep(400)

  const observed = {
    rowLine: (readLog().split("\n").find((line) => line.includes("[mpd-team-watchdog] applied:")) ?? "").trim(),
    preset,
    createOk: created.body.includes('"ok":true'),
    promptAccepted: prompt !== null && prompt.body.includes('"accepted":true'),
    copied: s.copied,
    settingsPresent: s.copied.includes("settings.yaml"),
    turnEnds: lines.filter((line) => line.includes('"turn/end"')),
    assistantMessages: lines.filter((line) => line.includes('"assistant/message"')),
  }
  const verdict = evaluate(observed)
  const result = {
    task: "the watchdog's row mounted in a REAL dsh does not veto the turn machinery (pre-step waterfall)",
    lane: SLUG,
    heavy: true,
    workspace: s.ws,
    dshHome: s.home,
    copiedFiles: s.copied,
    observed: { ...observed, turnEnds: observed.turnEnds.slice(-3).map((line) => line.slice(0, 400)), assistantMessages: observed.assistantMessages.slice(-1).map((line) => line.slice(0, 400)) },
    outcome: verdict.outcome,
    reason: verdict.reason,
    checks: verdict.checks,
    ok: verdict.ok,
    notClaimed: [
      "This lane witnesses the INVARIANT (the row mounts and the turn machinery survives it). A `model-error` outcome (e.g. MISSING_CREDENTIAL — measured in this sandbox while the task was written) proves the turn reached the model call but is NOT a completed turn.",
      "No genuine provider wedge is claimed; this lane drives one normal prompt, not a wedge.",
    ],
  }
  const linesOut = []
  writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(dir, "output.log"), linesOut.join("\n") + "\n")
  out("outcome=" + verdict.outcome + " verdict=" + (verdict.ok ? "PASS" : "FAIL") + " — " + verdict.reason.slice(0, 200))
  for (const check of verdict.checks) out("  " + (check.ok ? "ok  " : "FAIL") + " " + check.id + ": " + check.detail.slice(0, 200))
  out("evidence: " + dir)
  return verdict.ok ? 0 : 1
}

// ─────────────────────────────── the offline self-test ───────────────────────────────
/**
 * The self-test carries TWO controls:
 *   1. the REAL vendored cordis waterfall, driven with the RETIRED shape
 *      (`(payload) => stamp` — no `next()`): the composed decision must BE the listener's return
 *      value, i.e. the veto is real on the implementation the harness ships. The same waterfall
 *      with the FIXED shape (`return next()`) must compose the fallback decision instead.
 *   2. the lane's own verdict: a synthesized veto turn/end must FAIL (outcome `veto`), a completed
 *      turn must PASS (`completed`), a model-level error must PASS for the invariant
 *      (`model-error`), and an empty log must FAIL (`no-turn`).
 */
export async function selfTest() {
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })

  const clean = { rowLine: "[mpd-team-watchdog] applied: enabled=true warnSilenceMs=90000 tickIntervalMs=15000 warnStreakToEscalate=3 actionOnEscalate=pause stateDir=.mpd/team disposers=5 holdService=mpdWatchdog hydratedHolds=0", preset: "mpd", createOk: true, promptAccepted: true, copied: [".credentials.yaml", "settings.yaml"], settingsPresent: true, turnEnds: [], assistantMessages: [] }
  const completed = { ...clean, turnEnds: ['{"type":"turn/end","data":{"turn":1,"reason":{"kind":"complete"}}}'], assistantMessages: ['{"type":"assistant/message","data":{"text":"watchdog-pre-step-ok"}}'] }
  const modelError = { ...clean, turnEnds: ['{"type":"turn/end","data":{"turn":1,"reason":{"kind":"error","error":{"message":"llm-deepseek: no API key for provider route \\"deepseek-official\\"; code: MISSING_CREDENTIAL","code":"MISSING_CREDENTIAL"}}}}'] }
  const veto = { ...clean, turnEnds: ['{"type":"turn/end","seq":5559,"data":{"turn":113,"reason":{"kind":"error","error":{"message":"Cannot read properties of undefined (reading \'map\')","code":"UNKNOWN"}}}}'] }
  const noTurn = clean

  add("C1", evaluate(completed).ok && evaluate(completed).outcome === "completed", "a completed turn passes as `completed`")
  add("C2", evaluate(modelError).ok && evaluate(modelError).outcome === "model-error", "a MODEL-level error passes as `model-error` (the turn reached the model call)")
  const vetoVerdict = evaluate(veto)
  add("C3", vetoVerdict.ok === false && vetoVerdict.outcome === "veto", "the veto signature FAILS as `veto` (" + vetoVerdict.outcome + ")")
  const noTurnVerdict = evaluate(noTurn)
  add("C4", noTurnVerdict.ok === false && noTurnVerdict.outcome === "no-turn", "an empty session log FAILS as `no-turn`")
  add("C5", evaluate({ ...clean, rowLine: "no apply line" }).ok === false, "a boot without the row's apply line FAILS")
  add("C6", evaluate({ ...completed, preset: "standard" }).ok === false, "a session not created on `mpd` FAILS")

  // The real cordis waterfall: the retired shape must veto, the fixed shape must not.
  try {
    const { Context } = await import(join(REPO, "packages/mpd-agent-teams-plugin/_deps/cordis/lib/index.js"))
    const FALLBACK = { kind: "enter", messages: ["claimed-user-message"] }
    const runWaterfall = (listener) => {
      const ctx = new Context()
      ctx.on("agent/pre-step", listener)
      // The vendored shape (measured in packages/mpd-agent-teams-plugin/test/pre-step-waterfall.test.ts):
      // the LAST argument is the innermost `next`, so it is a thunk returning the fallback decision.
      return ctx.waterfall(ctx, "agent/pre-step", { turn: 1 }, () => ({ ...FALLBACK }))
    }
    const retired = runWaterfall(() => ({ kind: "step", at: 1 }))
    const fixed = runWaterfall((_payload, next) => { const stamp = { kind: "step", at: 2 }; void stamp; return next() })
    add("C7", retired?.kind === "step" && retired?.messages === undefined,
      "the vendored cordis REALLY vetoes on the retired shape: the listener's return value became the decision (" + JSON.stringify(retired) + ")")
    add("C8", fixed?.kind === "enter" && Array.isArray(fixed?.messages),
      "the fixed shape (`return next()`) composes the fallback decision unchanged (" + JSON.stringify(fixed) + ")")
    checks.push({ id: "C9", ok: true, detail: "the cordis control ran against the REAL vendored implementation at packages/mpd-agent-teams-plugin/_deps/cordis/lib/index.js" })
  } catch (error) {
    checks.push({ id: "C7", ok: false, detail: "the cordis waterfall control could not run: " + String(error?.message ?? error) })
  }

  const ok = checks.every((check) => check.ok)
  for (const check of checks) console.log("[self-test] " + (check.ok ? "ok  " : "FAIL") + " " + check.id + ": " + check.detail)
  console.log("[self-test] " + (ok ? "PASS" : "FAIL") + " — " + SLUG + " (" + checks.length + " checks, " + checks.filter((check) => !check.ok).length + " failed)")
  return ok
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) {
  process.exit((await selfTest()) ? 0 : 1)
}
try {
  process.exit(await runReal(argv))
} catch (error) {
  console.error("[" + SLUG + "] CRASH: " + String(error?.stack ?? error))
  process.exit(1)
}
