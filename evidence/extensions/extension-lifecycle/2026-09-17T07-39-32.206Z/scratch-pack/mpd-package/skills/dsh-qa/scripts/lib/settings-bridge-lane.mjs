#!/usr/bin/env bun
// Shared engine for the two settings-bridge lanes:
//   • `web-settings-bridge.mjs` — the WEB arm: the HOST's own authenticated API (303 +
//     launch-token cookie, then the `settings/mutate(ns, ops, revision)` call any web
//     surface emits), on a real boot;
//   • `tui-settings-bridge.mjs`   — the TUI arm: the built TUI bytes, the §D.2 hint
//     disclosure and the §D.2 `no-live-session` RUNTIME NOTICE on the status line.
// Both arms prove the same subject: the `mpd` settings namespace really drives
// `<workspace>/.mpd/mpd.jsonc` (t34 design §1/§2/§A.1/§D; t35 acceptance A1-A4/A6).
// No lane here drives TUI KEYSTROKES (tui-panels owns that) and none renders the WEB surface
// (this client mounts its own top-level `settings.section`; the pre-move Plugins-tab CARD was cut
// by the user), because no browser exists in this environment.
//
// WHAT THIS LANE DRIVES, stated exactly: the host's own `settings/mutate` RPC over the
// gateway (the SAME wire call the web section and the TUI section emit), against a REAL boot of
// the bundle in an isolated DSH_HOME + sandbox HOME + sandbox WORKSPACE. It does NOT send
// TUI keystrokes (a keystroke drive needs a TTY; tui-panels owns that surface and this lane
// only asserts the reworded disclosure is in the built TUI bytes) and it does NOT render
// the web settings SECTION (no browser exists here — its rendered state is NOT-CLAIMED); the
// SECTION's registration shape is asserted against the BUILT client bytes instead (W2a-W2f).
//
// Falsifiers this lane must be able to catch (design §9.3 F1/F2/F4/F5, plus the disabled
// negative control of §10.2):
//   F1 the file is unchanged after a front-door edit the RPC accepted;
//   F2 the file changed but a comment / the key order was lost, or the file stopped parsing;
//   F4 with zero live roots some file was written anyway (a guessed workspace);
//   F5 with two live roots any file was written instead of the `ambiguous-multi-root` refusal;
//   A6 the write-back switch (`writeBack: false`, the design's key; `settingsBridge.writeBack`
//      is also honoured) did not disable the FILE write
//      while the settings value still landed.
//
// NEGATIVE CONTROLS (recorded, all required): (1) the switch-off boot must show the file
// byte-identical while the mutate still succeeds — if that assertion cannot fail, the lane is
// void; (2) the assertion engine is re-run with an injected fault against the SAME artifacts
// (`negative/control.json`) and must go red; (3) the W2 section-shape checks are re-run with the
// PRE-MOVE `settings.plugin.item` card registration re-injected into the REAL built client bytes
// (`raw/card-shape-control.json`) and W2a/W2b must go red — a mutation that does not land is
// recorded as VOID and fails the run.
//
// PREREQ: absent-dsh-binary dsh "npm i -g @deepseek-ai/dsh (or run inside a checkout install)"
// PREREQ: absent-bundle-dist packages/mpd-config-plugin/dist/index.js "bun build packages/mpd-config-plugin/src/index.ts --target node --format esm --outfile packages/mpd-config-plugin/dist/index.js"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-settings-bridge.mjs --self-test
//   bun skills/dsh-qa/scripts/tui-settings-bridge.mjs [--out <dir>] [--keep]
// Evidence -> evidence/mpd-bridge/settings-bridge-lane/<timestamp>/{result.json,output.log,raw/}
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createServer } from "node:net"
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, symlinkSync, writeFileSync, cpSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { sandboxWorkspace, assertSessionsSandboxed } from "./workspace-isolation.mjs"

const REPO = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))
export const LANE_SLUG = "settings-bridge"
export const WEB_ARM_SLUG = "web-settings-bridge"
export const TUI_ARM_SLUG = "tui-settings-bridge"
const PORT_OVERRIDE = process.env.MPD_QA_SETTINGS_BRIDGE_PORT === undefined ? undefined : Number(process.env.MPD_QA_SETTINGS_BRIDGE_PORT)
export const NS = "mpd"
export const KNOB = ["hashline", "maxDiffChars"]
const VALUE_WRITE = 31415
const VALUE_AMBIGUOUS = 27182
/** The fixture's FILE value — the captain's falsifying number: it is NOT the schema default (20000),
 *  so a namespace whose base reports 35000 can only have derived it from `<workspace>/.mpd/mpd.jsonc`
 *  (t39 acceptance 4). */
export const VALUE_INITIAL = 35000

/**
 * Find one namespace descriptor anywhere in a describe response. The RPC envelope's nesting is the
 * HOST's business (measured: `settings/mutate` answers `{ok, value:<descriptor>}`), so the lane
 * searches structurally instead of assuming a shape — and records the observed envelope keys.
 */
function findNamespaceDescriptor(payload, ns) {
  const seen = new Set()
  const stack = [payload]
  while (stack.length > 0) {
    const node = stack.pop()
    if (node === null || node === undefined || typeof node !== "object" || seen.has(node)) continue
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) if (item !== null && typeof item === "object") stack.push(item)
      continue
    }
    if (String(node.ns ?? "") === ns) return node
    for (const value of Object.values(node)) if (value !== null && typeof value === "object") stack.push(value)
  }
  return undefined
}

/** Minimal JSONC read for the lane's own two-surface agreement check (comments + trailing commas). */
function readJsoncLike(text) {
  const stripped = String(text)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/,(\s*[}\]])/g, "$1")
  return JSON.parse(stripped)
}

/** The fixture: comments, a trailing comma and a non-alphabetical order — all must survive. */
export function fixture(value) {
  return `{\n  // human comment: must survive the write-back\n  "hashline": {\n    "maxDiffChars": ${value},\n  },\n  "ulw": { "maxRounds": 6 },\n}\n`
}

/** A file with a DUPLICATED leaf key, so the lane can witness the settled duplicate-key ruling. */
function duplicateFixture(value) {
  return `{\n  "ulw": {\n    "maxRounds": 3,\n    "maxRounds": ${value},\n  },\n}\n`
}

/** The one report line shape the bridge emits, so a lane asserts on structure, not prose. */
export function bridgeReports(logText) {
  const reports = []
  for (const line of String(logText).split("\n")) {
    const at = line.indexOf("[mpd-config] settings bridge")
    if (at === -1) continue
    const brace = line.indexOf("{", at)
    if (brace === -1) {
      reports.push({ message: line.slice(at).trim(), parsed: null })
      continue
    }
    let parsed = null
    try {
      parsed = JSON.parse(line.slice(brace))
    } catch {
      parsed = null
    }
    reports.push({ message: line.slice(at).trim(), parsed })
  }
  return reports
}

/**
 * The assertion engine. Pure: it judges artifacts (the RPC result, the file bytes before and
 * after, the boot log) and returns one result per check, so the self-test can falsify it.
 * @param observed - one boot's measured facts.
 * @returns per-check results and the overall verdict.
 */
export function evaluateBridge(observed) {
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })
  const mode = observed.mode
  const mutateOk = observed.mutate?.ok === true
  const reports = bridgeReports(observed.log ?? "")
  const structured = reports.map((report) => report.parsed).filter((parsed) => parsed !== null)
  const fileChanged = observed.fileBefore !== observed.fileAfter

  if (mode === "write") {
    add("W1", mutateOk, "the front door accepted the settings write (" + (observed.mutate?.detail ?? "no detail") + ")")
    add("W2", fileChanged, "the live workspace's .mpd/mpd.jsonc changed after the accepted write")
    let parsed = null
    try {
      parsed = JSON.parse(String(observed.fileAfter).replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"))
    } catch (error) {
      parsed = null
    }
    const value = KNOB.reduce((acc, part) => (acc == null ? undefined : acc[part]), parsed)
    add("W3", value === observed.expectedValue, "the written value is " + observed.expectedValue + " (read back " + JSON.stringify(value) + ")")
    add("W4", String(observed.fileAfter).includes("// human comment: must survive the write-back"), "the human comment survived (F2)")
    add("W5", String(observed.fileAfter).includes('"ulw": { "maxRounds": 6 }') && String(observed.fileAfter).indexOf('"hashline"') < String(observed.fileAfter).indexOf('"ulw"'), "key order was not rewritten (F2)")
    add("W6", String(observed.fileAfter).includes(String(observed.initialValue)) === false, "the previous value is gone from the edited span")
    const wrote = structured.find((report) => Array.isArray(report.writtenTo) && report.writtenTo.length > 0)
    add("W7", wrote !== undefined, "the boot log carries a bridge report naming the file it wrote (F1: silence would hide a dead bridge)")
    add("W8", structured.some((report) => report.source === "update"), "the write-back was triggered by an `update`, not a provider echo (design §2.1)")
    add("W9", structured.every((report) => report.applies === "restart"), "every report carries applies:'restart' (design §D.1 honesty)")
    add("W10", ((wrote?.writtenTo) ?? []).some((file) => String(file).includes(".mpd/mpd.jsonc")), "the report names a .mpd/mpd.jsonc path")
    // OBSERVATION 3 (the plugin's resolved value changed): the host answered the write with a
    // descriptor whose RESOLVED value — the layer `mpd-config` merges as L3 and every mpd plugin
    // reads — is the written value, and whose raw user section carries it too.
    add("W11", observed.mutate?.resolved === observed.expectedValue, "the RESOLVED namespace value the mpd config layer merges changed to " + observed.expectedValue + " (descriptor value = " + JSON.stringify(observed.mutate?.resolved) + ")")
    add("W12", observed.mutate?.user === observed.expectedValue, "the settings USER section (the L3 layer) carries the written value (" + JSON.stringify(observed.mutate?.user) + ")")
    // §10.1: THIS is why `mpd-config` owns the registration — the namespace serves the FILE-DERIVED
    // base, so a front door shows the real inherited value instead of a schema default (the fixture's
    // file value differs from the schema default on purpose).
    // AGREEMENT (W14/W15): the namespace's resolved value (the settings surface) must equal the
    // value the durable file carries, read INDEPENDENTLY through the minimal JSONC reader below.
    // W15 names the authoritative read-back surface (`settings/describe`), so a reviewer can see
    // WHICH surface the resolved value came from.
    const fileValueAtRead = (() => {
      try {
        const parsed = readJsoncLike(String(observed.fileAfter))
        return parsed?.hashline?.maxDiffChars
      } catch {
        return undefined
      }
    })()
    add("W15", observed.describedValue === observed.expectedValue,
      "the AUTHORITATIVE read surface (settings/describe) agrees: its resolved value is " + observed.expectedValue + " (read " + JSON.stringify(observed.describedValue) + ")")
    add("W14", fileValueAtRead === observed.expectedValue && observed.mutate?.resolved === observed.expectedValue,
      "the TWO SURFACES AGREE: the settings namespace's resolved value (" + JSON.stringify(observed.mutate?.resolved) + ") equals the value the file on disk carries (" + JSON.stringify(fileValueAtRead) + ")")
    add("W13", observed.mutate?.base === observed.initialValue, "the namespace's BASE is the FILE value " + String(observed.initialValue) + " (" + JSON.stringify(observed.mutate?.base) + "), not the schema default 20000 — §10.1's reason for mpd-config owning the registration, and the falsifier t39 asks for")
  }

  if (mode === "disabled") {
    add("D1", mutateOk, "the settings write still succeeded with the write-back disabled (" + (observed.mutate?.detail ?? "no detail") + ")")
    add("D2", !fileChanged, "the file is BYTE-IDENTICAL with `writeBack: false` composed from a patch layer (A6 negative control)")
    add("D3", structured.some((report) => report.skipped === "disabled"), "the bridge reported skipped:'disabled'")
    add("D4", !reports.some((report) => report.message.includes("not bridged")), "no surface claims the section is unbridged any more")
  }

  if (mode === "ambiguous") {
    add("A1", mutateOk, "the settings write succeeded with two live roots (" + (observed.mutate?.detail ?? "no detail") + ")")
    add("A2", observed.files.every((entry) => entry.before === entry.after), "NO file changed with two live roots (F5 must-fail-on-fanout)")
    const refused = structured.find((report) => report.skipped === "ambiguous-multi-root")
    add("A3", refused !== undefined, "the bridge reported skipped:'ambiguous-multi-root'")
    const named = (refused?.candidates ?? []).map((entry) => String(entry))
    add("A4", observed.roots.every((root) => named.includes(root)), "the structured refusal names EVERY candidate root, not a guess (" + JSON.stringify(named) + ")")
    add("A5", observed.roots.every((root) => String(observed.log).includes(root)), "the human-readable diagnostic names every candidate too")
  }

  if (mode === "static") {
    const dist = String(observed.tuiDist ?? "")
    add("S1", dist.includes("a save writes <workspace>/.mpd/mpd.jsonc"), "the built TUI bytes carry the bridge disclosure")
    add("S2", dist.includes("after a restart"), "the built TUI bytes carry the restart half of the disclosure")
    add("S3", !dist.includes("not bridged: a save here does not rewrite"), "the old 'not bridged' claim is DELETED from the built TUI bytes")
  }

  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks }
}

// ─────────────────────────────── real run plumbing ───────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A FREE port, so a leftover listener can never turn this lane's real assertions into a
 * confusing `ECONNREFUSED` cascade. MEASURED: a fixed port produced exactly that — the boot
 * died with `EADDRINUSE` while the lane reported "the front door rejected the write".
 */
async function freePort() {
  if (PORT_OVERRIDE !== undefined) return PORT_OVERRIDE
  return await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

function makeSandbox(tag, mountRoot) {
  return makeSandboxIn(mkdtempSync(join(tmpdir(), "mpd-settings-bridge-" + tag + "-")), tag, mountRoot)
}

function makeSandboxIn(sandbox, tag, mountRoot) {
  const home = join(sandbox, "home")
  const userHome = join(sandbox, "userhome")
  const profile = join(home, "profiles", "w")
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (existsSync(creds)) cpSync(creds, join(home, ".credentials.yaml"))
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(home, "settings.yaml"))
  symlinkSync(REPO, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
  }, null, 2))
  const patches = []
  if (tag === "disabled") {
    // The A6 lever, composed from THIS layer: the same row the bundle ships, with the
    // write-back switched off. An id-targeted patch UPDATES the row (never duplicates it).
    const overlay = join(sandbox, "control-writeback-off.yml")
    writeFileSync(overlay, [
      "- id: mpd-config",
      "  name: '@mpd-dsh/mpd/packages/mpd-config-plugin/dist/index.js'",
      "  config:",
      "    # the design's flat key (§10.2 lever 1); `settingsBridge.writeBack` is also honoured",
      "    writeBack: false",
      "",
    ].join("\n"))
    patches.push("--patch", overlay)
  }
  if (home.startsWith(join(homedir(), ".dsh"))) throw new Error("isolation assertion: DSH_HOME points at the real home")
  // `DSH_WORKSPACE_ROOT` is the documented OPERATOR/QA override for the exec-less root — the
  // adapter's precedence is session cwd > this env > process.cwd(). A plugin row must NEVER set it
  // (AGENTS.md §6); a lane pinning the mount-time root so the file-derived base is witnessable is
  // exactly the sanctioned use, and the real-run note records the limitation it works around:
  // without it, the mount-time root is the process cwd, which no session workspace equals yet.
  const env = { ...process.env, DSH_HOME: home, HOME: userHome, ...(mountRoot === undefined ? {} : { DSH_WORKSPACE_ROOT: mountRoot }) }
  return { sandbox, home, userHome, profile, patches, env }
}

function workspace(sandbox, name, value = VALUE_INITIAL) {
  const ws = sandboxWorkspace(sandbox.sandbox, name)
  mkdirSync(join(ws, ".mpd"), { recursive: true })
  const file = join(ws, ".mpd", "mpd.jsonc")
  writeFileSync(file, fixture(value))
  return { ws, file }
}

async function boot(sandbox, logPath, port) {
  const fd = openSync(logPath, "w")
  const child = spawn("dsh", ["--profile", "w", ...sandbox.patches, "--port", String(port), "--no-open"], {
    env: sandbox.env, cwd: sandbox.sandbox, stdio: ["ignore", fd, fd],
  })
  const readLog = () => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  let token = ""
  let cookie = ""
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    await sleep(1500)
    // An early death (a taken port, a bad profile) must be reported as ITSELF, never as a
    // wall of failed front-door assertions.
    const started = readLog()
    if (/EADDRINUSE/.test(started)) throw new Error("the boot could not listen on 127.0.0.1:" + String(port) + " (EADDRINUSE) — another process holds the port; the lane picked " + String(port) + " as free")
    if (child.exitCode !== null && child.exitCode !== undefined && token === "") {
      throw new Error("the boot exited early with code " + String(child.exitCode) + " before serving; log tail: " + started.split("\n").slice(-6).join(" | "))
    }
    const match = /token=([A-Za-z0-9_-]+)/.exec(readLog())
    if (match !== null) token = match[1]
    if (token === "") continue
    try {
      const authorize = await fetch(`http://127.0.0.1:${port}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(8000) })
      cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ") || cookie
      const root = await fetch(`http://127.0.0.1:${port}/`, { headers: cookie === "" ? {} : { cookie }, signal: AbortSignal.timeout(8000) })
      if (cookie !== "" && root.status === 200) break
    } catch { /* not serving yet */ }
  }
  return { child, readLog, token, cookie }
}

async function rpc(port, cookie, method, args, timeout = 30000) {
  const rpcId = LANE_SLUG + "-" + method.replace("/", "-") + "-" + String(Date.now())
  const response = await fetch(`http://127.0.0.1:${port}/api/${method.split("/")[0]}/${method.split("/")[1]}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload: { args } }),
    signal: AbortSignal.timeout(timeout),
  }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
  const envelope = await response.json().catch(() => ({}))
  return { status: response.status, result: envelope?.result ?? null, error: envelope?.error ?? null, transport: envelope?.transport ?? null }
}

async function createSession(port, cookie, cwd) {
  const response = await fetch(`http://127.0.0.1:${port}/api/session/create`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
    body: JSON.stringify({ type: "client-request", rpcId: LANE_SLUG + "-session-" + String(Date.now()), method: "session/create", payload: { args: { request: { cwd, agentPreset: "mpd" } } } }),
    signal: AbortSignal.timeout(90000),
  }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
  const envelope = await response.json().catch(() => ({}))
  return { status: response.status, result: envelope?.result ?? null, error: envelope?.error ?? null, transport: envelope?.transport ?? null }
}

async function stop(child) {
  try { child.kill("SIGTERM") } catch { /* already gone */ }
  await sleep(2000)
  try { child.kill("SIGKILL") } catch { /* already gone */ }
}

function redact(text) {
  return String(text).replace(/token=[A-Za-z0-9_-]+/g, "token=<redacted>")
}

/**
 * One boot's mutate, reduced to what the engine judges. The host's own descriptor is kept
 * because it is the RESOLVED namespace value — exactly what the mpd config layer merges as
 * its L3 layer, i.e. the value a plugin reads.
 */
function mutateOutcome(response, expectedValue) {
  // The RPC envelope is `{ok, value:<namespace descriptor>}` (MEASURED against the host's
  // settings controller); the descriptor is what carries `value`/`user`/`revision`.
  const envelope = response?.result
  const descriptor = envelope?.value ?? envelope ?? null
  const revision = descriptor?.revision ?? null
  const resolved = KNOB.reduce((acc, part) => (acc === null || acc === undefined ? undefined : acc[part]), descriptor?.value)
  const base = KNOB.reduce((acc, part) => (acc === null || acc === undefined ? undefined : acc[part]), descriptor?.base)
  const user = KNOB.reduce((acc, part) => (acc === null || acc === undefined ? undefined : acc[part]), descriptor?.user)
  return {
    ok: response?.status === 200 && response?.error === null && response?.transport === null,
    detail: response?.transport ?? (response?.error === null || response?.error === undefined ? "status " + String(response?.status) + " revision " + String(revision) + " resolved " + JSON.stringify(resolved) : JSON.stringify(response.error)),
    resolved,
    user,
    revision,
    base,
  }
}

/**
 * The TUI arm: what can be witnessed about the TUI half WITHOUT a keystroke drive.
 *   1. the built TUI bytes carry the bridge+restart disclosure and NOT the old claim;
 *   2. the built TUI bytes carry the §D.2 `no-live-session` runtime notice AND the code that
 *      publishes it on the status line (the notice must be reachable, not just defined);
 *   3. the TUI package still performs zero filesystem writes (the invariant the captain
 *      re-checks), read from the built bytes so a source-only claim cannot pass.
 * NOT driven here: TUI keystrokes (`tui-panels` owns that surface) and any rendered card
 * (the card was cut; no browser exists). Both are recorded as NOT-CLAIMED in the result.
 * @param argv - the CLI arguments (`--out <dir>`).
 * @returns the exit code.
 */
export const TUI_NOTICE = "saved to settings — not yet written to any .mpd/mpd.jsonc (no live session)"

/**
 * Judge the TUI surface from the built bytes alone (pure, so the self-test can falsify it).
 * @param observed - the built dist text, the source text and the notice sentence.
 * @returns per-check results and the overall verdict.
 */
export function evaluateTuiSurface(observed) {
  const dist = String(observed.dist ?? "")
  const src = String(observed.src ?? "")
  const notice = String(observed.notice ?? TUI_NOTICE)
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })
  add("T1", dist.includes("a save writes <workspace>/.mpd/mpd.jsonc"), "the built bytes carry the bridge+restart disclosure")
  add("T2", dist.includes("after a restart"), "the built bytes carry the restart half of the disclosure")
  add("T3", !dist.includes("not bridged: a save here does not rewrite"), "the old 'not bridged' claim is DELETED from the built bytes")
  add("T4", dist.includes(notice), "the built bytes carry the §D.2 no-live-session runtime notice")
  add("T5", dist.includes("NO_LIVE_SESSION_NOTICE") && dist.includes("statusLine("), "the notice is WIRED into the status-line composition, not merely defined")
  add("T6", src.includes(notice), "the notice is a single exported constant in the source (one source of truth)")
  add("T8", dist.includes("never lost") && dist.includes("applies it to every workspace immediately"), "the hint carries the \"never lost\" clause (a settings-only save is not a lost save)")
  const writeApis = ["writeFileSync", "appendFileSync", "mkdirSync", "cpSync", "rmSync", "unlinkSync", "createWriteStream"]
  const offenders = writeApis.filter((api) => dist.includes(api))
  add("T7", offenders.length === 0, "the TUI dist performs ZERO filesystem writes (offenders: " + JSON.stringify(offenders) + ")")
  return { ok: checks.every((check) => check.ok), checks }
}

export async function runTuiArm(argv) {
  const outIndex = argv.indexOf("--out")
  const outDir = outIndex === -1 ? join(REPO, "evidence", "mpd-bridge", TUI_ARM_SLUG, timestamp()) : argv[outIndex + 1]
  const lines = []
  const say = (message) => { lines.push(message); console.log(message) }
  const started = Date.now()
  const distPath = join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js")
  const result = {
    slug: TUI_ARM_SLUG,
    arm: "tui (built bytes: the hint disclosure, the §D.2 runtime notice, zero-write)",
    startedAt: new Date().toISOString(), repo: REPO, outDir,
    surface: {
      drives: "the built TUI bytes + the status-line notice path; NOT TUI keystrokes (tui-panels owns that)",
      tuiKeystrokes: "not-run: a keystroke drive needs a real TTY",
      webCardRendered: "NOT-CLAIMED: the card was cut by the user and no browser exists here",
    },
  }
  if (!existsSync(distPath)) {
    result.ok = false
    result.notes = ["PREREQ absent: packages/mpd-tui-plugin/dist/index.js (build it first)"]
    writeEvidence(outDir, result, lines.join("\n"))
    console.error("[" + TUI_ARM_SLUG + "] SKIP: missing TUI dist build")
    return 2
  }
  const srcFile = join(REPO, "packages", "mpd-tui-plugin", "src", "state.ts")
  const verdict = evaluateTuiSurface({
    dist: readFileSync(distPath, "utf8"),
    src: existsSync(srcFile) ? readFileSync(srcFile, "utf8") : "",
    notice: TUI_NOTICE,
  })
  const checks = verdict.checks
  result.checks = checks
  result.ok = checks.every((check) => check.ok)
  result.distPath = relative(REPO, distPath)
  result.elapsedMs = Date.now() - started
  result.notes = [
    "This arm proves the TUI SURFACE (words on screen + the notice path + the zero-write invariant).",
    "It does NOT prove a keystroke edit in /settings (tui-panels drives keystrokes with a real TTY) and it does NOT render a card.",
    "The write path itself is proven by `web-settings-bridge.mjs` (the host's own authenticated API), which is the same settings/mutate the TUI section emits.",
  ]
  writeEvidence(outDir, result, lines.join("\n"))
  say("[" + TUI_ARM_SLUG + "] " + checks.map((check) => check.id + (check.ok ? "=ok" : "=FAIL")).join(" "))
  say("[" + TUI_ARM_SLUG + "] " + (result.ok ? "PASS" : "FAIL") + " -> " + relative(REPO, outDir))
  return result.ok ? 0 : 1
}

// ──────────────────── the SHIPPED web registration shape (W2) ────────────────────

/**
 * The descriptor the built client hands to the host's `settings.section` LIST slot: the slot name,
 * this section's stable id, its explicit order and the locale namespace its labels resolve through.
 */
const SECTION_DESCRIPTOR = /\{ name: SECTION_SLOT, id: SECTION_ID, order: SECTION_ORDER, label: \(\) => dicts\.en\.nav, locale: LOCALE_NS, inject: \(\) => controller\.inject\(\) \}/

/**
 * Judge the web registration from the BUILT client bytes (pure, so the self-test and the lane's own
 * negative control can falsify it). The SHIPPED shape is this client's OWN top-level
 * `settings.section` LIST slot — `id "mpd"`, `order 20`, locale `mpdSettings` — because w14/t83 moved
 * the knobs off the Plugins tab's per-namespace `settings.plugin.item` CARD into their own section.
 * The bytes are read from the built/served artifact (the bundle serves `exports["./client"]`), never
 * from a source string, because the built bytes are what a browser actually loads.
 * @param clientBytes - the BUILT client text (`packages/mpd-bundle-plugin/client.js`).
 * @param cardSource - the registration's source text (the disclosure cross-check).
 * @returns per-check results and the overall verdict.
 */
export function evaluateSettingsSectionShape(clientBytes, cardSource) {
  const bytes = String(clientBytes ?? "")
  const src = String(cardSource ?? "")
  const constant = (name) => {
    const match = new RegExp("const " + name + " = ([^\\n]+)").exec(bytes)
    return match === null ? undefined : match[1].trim().replace(/[;,]\s*$/, "")
  }
  const slot = constant("SECTION_SLOT")
  const id = constant("SECTION_ID")
  const order = constant("SECTION_ORDER")
  const locale = constant("LOCALE_NS")
  const checks = []
  const add = (checkId, ok, detail) => checks.push({ id: checkId, ok: Boolean(ok), detail: String(detail) })
  add("W2a", bytes.includes("ctx.slots.inject(SECTION_SLOT, function* () {") && SECTION_DESCRIPTOR.test(bytes), "the BUILT client injects the `settings.section` LIST slot and registers the shipped descriptor (name/id/order/label/locale/inject)")
  add("W2b", slot === '"settings.section"' && id === '"mpd"' && order === "20" && locale === '"mpdSettings"', "the built client names the slot " + String(slot) + " with id " + String(id) + ", order " + String(order) + ", locale " + String(locale) + ' (want "settings.section" / "mpd" / 20 / "mpdSettings")')
  add("W2c", bytes.includes('ctx.inject(["settingsScope"]'), "the section's mount is DEFERRED through ctx.inject (never a declared dependency)")
  add("W2d", bytes.includes('const REQUIRED_SERVICES = ["slots", "locale"]') && !bytes.includes('REQUIRED_SERVICES = ["slots", "locale", "settingsScope"]'), "the client still declares only the stable seams")
  add("W2e", src.includes("a save writes <workspace>/.mpd/mpd.jsonc"), "the section's copy is the same disclosure the TUI states")
  add("W2f", !bytes.includes("settings.plugin.item"), "the PRE-MOVE `settings.plugin.item` card slot is ABSENT from the built client (the move to its own section is complete)")
  return { ok: checks.every((check) => check.ok), checks }
}

// ─────────────────────────────── evidence helpers ───────────────────────────────

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
}

function writeEvidence(dir, result, stdout) {
  mkdirSync(join(dir, "raw"), { recursive: true })
  writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(dir, "output.log"), stdout + "\n")
  return dir
}

// ─────────────────────────────── self-test ───────────────────────────────

export function selfTest(arm = "web") {
  const problems = []
  const green = {
    write: {
      mode: "write",
      mutate: { ok: true, detail: "status 200 revision 3", resolved: VALUE_WRITE, user: VALUE_WRITE, base: VALUE_INITIAL },
      expectedValue: VALUE_WRITE,
      initialValue: VALUE_INITIAL,
      describedValue: VALUE_WRITE,
      describedBase: VALUE_INITIAL,
      fileBefore: fixture(VALUE_INITIAL),
      fileAfter: fixture(VALUE_WRITE),
      log: 'x\n[mpd-config] settings bridge WROTE: {"writtenTo":["/ws/.mpd/mpd.jsonc"],"skipped":null,"candidates":[],"results":[{"root":"/ws","file":"/ws/.mpd/mpd.jsonc","outcome":"written"}],"applies":"restart","source":"update","revision":3}\n',
    },
    disabled: {
      mode: "disabled",
      mutate: { ok: true, detail: "status 200 revision 4" },
      fileBefore: fixture(VALUE_INITIAL),
      fileAfter: fixture(VALUE_INITIAL),
      log: '[mpd-config] settings bridge: write-back is DISABLED by config (settingsBridge.writeBack=false or MPD_DSH_TUI_SETTINGS_BRIDGE=off) — the settings value took effect, no file was written.\n[mpd-config] settings bridge DISABLED: {"writtenTo":[],"skipped":"disabled","candidates":[],"results":[],"applies":"restart","source":"update","revision":4}\n',
    },
    ambiguous: {
      mode: "ambiguous",
      mutate: { ok: true, detail: "status 200 revision 5" },
      roots: ["/ws1", "/ws2"],
      files: [{ before: fixture(VALUE_WRITE), after: fixture(VALUE_WRITE) }, { before: fixture(VALUE_INITIAL), after: fixture(VALUE_INITIAL) }],
      log: '[mpd-config] settings bridge: saved to settings — NOT written to any file: 2 live workspaces, so the target is ambiguous. Candidates: /ws1, /ws2. Keep one session live, or edit that workspace\'s .mpd/mpd.jsonc directly.\n[mpd-config] settings bridge ambiguous-multi-root: {"writtenTo":[],"skipped":"ambiguous-multi-root","candidates":["/ws1","/ws2"],"results":[],"applies":"restart","source":"update","revision":5}\n',
    },
    static: { mode: "static", tuiDist: "var BRIDGE_DISCLOSURE = \"a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes effect for the mpd plugins after a restart (this knob is read at plugin mount)\";" },
  }
  for (const [name, observed] of Object.entries(green)) {
    const verdict = evaluateBridge(observed)
    if (!verdict.ok) problems.push("self-test: the synthetic GREEN " + name + " observation must pass, failed: " + JSON.stringify(verdict.checks.filter((check) => !check.ok)))
  }
  const faults = [
    ["W2", "write", (copy) => { copy.fileAfter = copy.fileBefore }, "an unchanged file after an accepted write (F1)"],
    ["W4", "write", (copy) => { copy.fileAfter = copy.fileAfter.replace("// human comment: must survive the write-back", "// gone") }, "a lost comment (F2)"],
    ["W7", "write", (copy) => { copy.log = "no bridge report here at all" }, "a boot log with no bridge report"],
    ["W8", "write", (copy) => { copy.log = copy.log.replace('"source":"update"', '"source":"provider"') }, "a provider echo doing the write-back"],
    ["W9", "write", (copy) => { copy.log = copy.log.replace('"applies":"restart"', '"applies":"immediate"') }, "a wrong applies timing"],
    ["W11", "write", (copy) => { copy.mutate.resolved = 20000 }, "a resolved value the config layer never saw (the file changed but the value did not)"],
    ["W12", "write", (copy) => { copy.mutate.user = undefined }, "an empty user section (nothing for the L3 layer to merge)"],
    ["W15", "write", (copy) => { copy.describedValue = 20000 }, "a describe surface that disagrees with the written value"],
    ["W14", "write", (copy) => { copy.fileAfter = copy.fileAfter.replace(String(copy.expectedValue), "1") }, "a file whose value disagrees with the namespace (the two-surface agreement check)"],
    ["W13", "write", (copy) => { copy.mutate.base = 20000 }, "a base carrying the schema default instead of the file value (§10.1's whole point)"],
    ["D2", "disabled", (copy) => { copy.fileAfter = fixture(VALUE_WRITE) }, "the disabled switch writing anyway (A6)"],
    ["D3", "disabled", (copy) => { copy.log = "no report" }, "a disabled run with no report"],
    ["A2", "ambiguous", (copy) => { copy.files[1].after = fixture(VALUE_AMBIGUOUS) }, "a fan-out to the second root (F5)"],
    ["A3", "ambiguous", (copy) => { copy.log = "no report" }, "an ambiguous run with no refusal report"],
    ["A4", "ambiguous", (copy) => { copy.log = copy.log.replaceAll('"/ws2"', '"/ws-x"') }, "a structured refusal that omits a candidate"],
    ["A5", "ambiguous", (copy) => { copy.log = copy.log.replaceAll("/ws2", "/ws-x") }, "a diagnostic that does not name every candidate"],
    ["S3", "static", (copy) => { copy.tuiDist = "not bridged: a save here does not rewrite .mpd/mpd.jsonc" }, "the stale 'not bridged' claim in the built TUI bytes"],
    ["S1", "static", (copy) => { copy.tuiDist = "nothing to see" }, "a built TUI without the bridge disclosure"],
  ]
  for (const [id, name, inject, label] of faults) {
    const copy = JSON.parse(JSON.stringify(green[name]))
    inject(copy)
    const verdict = evaluateBridge(copy)
    const check = verdict.checks.find((entry) => entry.id === id)
    if (check === undefined) problems.push("self-test: injected fault " + label + " has no check " + id)
    else if (check.ok) problems.push("self-test: injected fault is INVISIBLE to the lane — " + label + " did not flip " + id)
    if (verdict.ok) problems.push("self-test: injected fault left the overall verdict GREEN — " + label)
  }
  // The TUI arm's pure evaluator, falsified with its own injected faults.
  const greenTui = { dist: "NO_LIVE_SESSION_NOTICE " + TUI_NOTICE + " a save writes <workspace>/.mpd/mpd.jsonc after a restart never lost applies it to every workspace immediately statusLine( ", src: TUI_NOTICE, notice: TUI_NOTICE }
  const tuiVerdict = evaluateTuiSurface(greenTui)
  if (!tuiVerdict.ok) problems.push("self-test: the synthetic GREEN TUI surface must pass, failed: " + JSON.stringify(tuiVerdict.checks.filter((check) => !check.ok)))
  const tuiFaults = [
    ["T1", (copy) => { copy.dist = copy.dist.replace("a save writes <workspace>/.mpd/mpd.jsonc", "nothing") }, "a dist without the disclosure"],
    ["T3", (copy) => { copy.dist = copy.dist + " not bridged: a save here does not rewrite" }, "the stale claim back in the dist"],
    ["T4", (copy) => { copy.dist = copy.dist.replace(TUI_NOTICE, "") }, "a dist without the §D.2 notice"],
    ["T5", (copy) => { copy.dist = copy.dist.replace("statusLine(", "") }, "a notice that is defined but never wired into the status line"],
    ["T6", (copy) => { copy.src = "" }, "a source without the notice constant"],
    ["T7", (copy) => { copy.dist = copy.dist + " writeFileSync(" }, "a TUI dist that writes to the filesystem"],
    ["T8", (copy) => { copy.dist = copy.dist.replace("never lost", "lost") }, "a hint without the never-lost clause"],
  ]
  for (const [id, inject, label] of tuiFaults) {
    const copy = JSON.parse(JSON.stringify(greenTui))
    inject(copy)
    const verdict = evaluateTuiSurface(copy)
    const check = verdict.checks.find((entry) => entry.id === id)
    if (check === undefined) problems.push("self-test: injected TUI fault " + label + " has no check " + id)
    else if (check.ok) problems.push("self-test: injected TUI fault is INVISIBLE — " + label + " did not flip " + id)
    if (verdict.ok) problems.push("self-test: injected TUI fault left the verdict GREEN — " + label)
  }
  // The W2 arm's own evaluator, falsified against a synthetic GREEN built-client fixture: every
  // injected fault must flip its own check. W2a/W2b are the two checks that were stale (they read
  // the PRE-MOVE `settings.plugin.item` card shape); W2f is the absence half of the same claim.
  const greenClient = [
    'const LOCALE_NS = "mpdSettings"',
    'const SECTION_SLOT = "settings.section"',
    'const SECTION_ID = "mpd"',
    'const SECTION_ORDER = 20',
    "ctx.slots.inject(SECTION_SLOT, function* () {",
    "{ name: SECTION_SLOT, id: SECTION_ID, order: SECTION_ORDER, label: () => dicts.en.nav, locale: LOCALE_NS, inject: () => controller.inject() },",
    'ctx.inject(["settingsScope"], (scoped) => {',
    'const REQUIRED_SERVICES = ["slots", "locale"]',
  ].join("\n")
  const greenCardSource = "a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s)"
  const greenShape = evaluateSettingsSectionShape(greenClient, greenCardSource)
  if (!greenShape.ok) problems.push("self-test: the synthetic GREEN built-client shape must pass, failed: " + JSON.stringify(greenShape.checks.filter((check) => !check.ok)))
  const shapeFaults = [
    ["W2a", (copy) => { copy.client = copy.client.replace("{ name: SECTION_SLOT, id: SECTION_ID, order: SECTION_ORDER, label: () => dicts.en.nav, locale: LOCALE_NS, inject: () => controller.inject() },", "{ name: SECTION_SLOT, key: NS, locale: LOCALE_NS, inject: () => controller.inject() },") }, "the PRE-MOVE card descriptor instead of the settings.section one"],
    ["W2b", (copy) => { copy.client = copy.client.replace('const SECTION_SLOT = "settings.section"', 'const SECTION_SLOT = "settings.plugin.item"') }, "a client whose slot is the pre-move `settings.plugin.item`"],
    ["W2b", (copy) => { copy.client = copy.client.replace("const SECTION_ORDER = 20", "const SECTION_ORDER = 15") }, "a client that names the wrong section order"],
    ["W2f", (copy) => { copy.client = copy.client + '\nctx.slots.register({ name: "settings.plugin.item", key: NS }, Card)' }, "the pre-move card slot back in the built client"],
  ]
  for (const [id, inject, label] of shapeFaults) {
    const copy = { client: greenClient, cardSource: greenCardSource }
    inject(copy)
    const verdict = evaluateSettingsSectionShape(copy.client, copy.cardSource)
    const check = verdict.checks.find((entry) => entry.id === id)
    if (check === undefined) problems.push("self-test: injected client-shape fault " + label + " has no check " + id)
    else if (check.ok) problems.push("self-test: injected client-shape fault is INVISIBLE — " + label + " did not flip " + id)
    if (verdict.ok) problems.push("self-test: injected client-shape fault left the verdict GREEN — " + label)
  }
  const armSlug = arm === "tui" ? TUI_ARM_SLUG : WEB_ARM_SLUG
  if (problems.length > 0) {
    console.error("[" + armSlug + " self-test] FAIL:")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + armSlug + " self-test] ok: " + String(faults.length) + " web-arm + " + String(tuiFaults.length) + " TUI-arm + " + String(shapeFaults.length) + " client-shape injected faults each flip their own check; all three synthetic green artifacts pass")
  process.exit(0)
}

// ─────────────────────────────── the real run ───────────────────────────────

export async function runWebArm(argv) {
  const outIndex = argv.indexOf("--out")
  const outDir = outIndex === -1 ? join(REPO, "evidence", "mpd-bridge", WEB_ARM_SLUG, timestamp()) : argv[outIndex + 1]
  const keep = argv.includes("--keep")
  const lines = []
  const say = (message) => { lines.push(message); console.log(message) }
  const started = Date.now()
  const result = {
    slug: WEB_ARM_SLUG, arm: "web (the HOST's own authenticated API: launch-token cookie + settings/mutate)",
    startedAt: new Date().toISOString(), repo: REPO, outDir,
    isolation: {}, boots: {}, verdicts: {}, controls: {}, notes: [], surface: {
      drives: "the host's own settings/mutate RPC (the same wire call the card and the TUI section emit)",
      tuiKeystrokes: "not-run: a keystroke drive needs a real TTY; tui-panels owns that surface",
      webCardRendered: "NOT-CLAIMED: no browser binary exists in this environment — the user's own GUI is the render check",
    },
  }

  if (!existsSync(join(REPO, "packages", "mpd-config-plugin", "dist", "index.js"))) {
    result.notes.push("PREREQ absent: packages/mpd-config-plugin/dist/index.js (build it first)")
    writeEvidence(outDir, result, lines.join("\n"))
    console.error("[" + LANE_SLUG + "] SKIP: missing dist build")
    return 2
  }
  result.surface.tuiDistScanned = "packages/mpd-tui-plugin/dist/index.js"
  // W2 — the settings SECTION's registration in the BUILT and SERVED client (the bundle serves
  // exports["./client"]). The shape asserted is the SHIPPED one: this client's own top-level
  // `settings.section` LIST slot (`id "mpd"`, `order 20`, locale `mpdSettings`).
  const clientPath = join(REPO, "packages", "mpd-bundle-plugin", "client.js")
  const cardSourcePath = join(REPO, "packages", "mpd-bundle-plugin", "src", "settings-card.js")
  const clientBytes = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : ""
  const cardSource = existsSync(cardSourcePath) ? readFileSync(cardSourcePath, "utf8") : ""
  const w2Checks = evaluateSettingsSectionShape(clientBytes, cardSource).checks
  // THE NEGATIVE CONTROL for W2: re-inject the PRE-MOVE card shape into the REAL built bytes and
  // require the SAME checks to redden. A control whose mutation does not land is VOID, so the
  // replacement is asserted to have changed the bytes (else the whole verdict fails below).
  const preMoveBytes = clientBytes
    .replace('const SECTION_SLOT = "settings.section"', 'const SECTION_SLOT = "settings.plugin.item"')
    .replace("{ name: SECTION_SLOT, id: SECTION_ID, order: SECTION_ORDER, label: () => dicts.en.nav, locale: LOCALE_NS, inject: () => controller.inject() }", "{ name: SECTION_SLOT, key: NS, locale: LOCALE_NS, inject: () => controller.inject() }")
  const preMoveChecks = evaluateSettingsSectionShape(preMoveBytes, cardSource).checks
  const controlMoved = preMoveBytes !== clientBytes
  const flipped = ["W2a", "W2b"]
  const controlReddened = controlMoved && flipped.every((checkId) => w2Checks.find((check) => check.id === checkId)?.ok === true && preMoveChecks.find((check) => check.id === checkId)?.ok === false)
  result.controls.sectionShape = {
    control: "the PRE-MOVE `settings.plugin.item` card registration re-injected into the REAL built client bytes (the defect this lane was red on)",
    mutationLanded: controlMoved,
    flippedChecks: flipped,
    verdictGoesRed: controlReddened,
    greenChecks: w2Checks,
    redChecks: preMoveChecks,
  }
  say("[negative control/card-shape] pre-move card shape re-injected into the built client -> " + (controlReddened ? "W2a/W2b red as required" : "CONTROL VOID (did not redden)") + " mutationLanded=" + String(controlMoved))

  // W3 is NOT witnessed: no browser exists here. Recorded, never implied.
  result.sectionClaim = {
    W2: { witnessed: w2Checks.every((check) => check.ok), shape: "the client's own top-level `settings.section` LIST slot (id \"mpd\", order 20, locale \"mpdSettings\")", checks: w2Checks, artifact: { path: "packages/mpd-bundle-plugin/client.js", bytes: Buffer.byteLength(clientBytes), sha256: createHash("sha256").update(clientBytes).digest("hex") } },
    W3: { witnessed: false, claim: "NOT-CLAIMED: no browser binary exists in this environment, so the rendered settings SECTION and a click that produces the mutate are the user's own GUI check" },
  }
  say("[card] " + w2Checks.map((check) => check.id + (check.ok ? "=ok" : "=FAIL")).join(" ") + " | W3 NOT-CLAIMED (no browser)")
  const tuiDist = existsSync(join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js")) ? readFileSync(join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js"), "utf8") : ""
  const staticVerdict = evaluateBridge({ mode: "static", tuiDist })
  result.verdicts.static = staticVerdict
  say("[static] " + staticVerdict.checks.map((check) => check.id + (check.ok ? "=ok" : "=FAIL")).join(" "))

  // ── boot 1: one live root (write) then two live roots (refusal) ──
  const mainSkeleton = mkdtempSync(join(tmpdir(), "mpd-settings-bridge-root-"))
  const main = makeSandboxIn(mainSkeleton, "main")
  result.isolation = { dshHome: main.home, home: main.userHome, sandbox: main.sandbox }
  const one = workspace(main, "ws-one")
  const two = workspace(main, "ws-two")
  // pin the mount-time root to the workspace the lane will create its session in
  main.env.DSH_WORKSPACE_ROOT = one.ws
  const logMain = join(outDir, "raw", "boot-main.log")
  mkdirSync(join(outDir, "raw"), { recursive: true })
  const PORT_MAIN = await freePort()
  result.ports = { main: PORT_MAIN }
  say("[boot] main: " + main.sandbox + " (port " + String(PORT_MAIN) + ")")
  const mainBoot = await boot(main, logMain, PORT_MAIN)
  say("[boot] cookie=" + (mainBoot.cookie === "" ? "NONE" : "present") + " log=" + relative(REPO, logMain))

  const sessionOne = await createSession(PORT_MAIN, mainBoot.cookie, one.ws)
  say("[session] one: status=" + String(sessionOne.status) + " transport=" + String(sessionOne.transport ?? "none"))
  await sleep(3000)

  const beforeWrite = readFileSync(one.file, "utf8")
  const mutateOne = await rpc(PORT_MAIN, mainBoot.cookie, "settings/mutate", { ns: NS, ops: [{ op: "set", path: KNOB, value: VALUE_WRITE }] })
  say("[mutate] one root: status=" + String(mutateOne.status) + " " + JSON.stringify(mutateOne.error ?? mutateOne.result ?? mutateOne.transport ?? {}))
  await sleep(2500)
  const afterWrite = readFileSync(one.file, "utf8")
  // ── THE AUTHORITATIVE READ-BACK SURFACE, named and exercised directly ──
  // `settings/describe` is the namespace's own read surface — the same one the Web card and the TUI
  // screen go through; the mutation response is derived from it. Reading it explicitly means a
  // reviewer can see WHICH surface the resolved value came from, and W14/W15 assert it AGREES with
  // the durable file.
  const describeCall = await rpc(PORT_MAIN, mainBoot.cookie, "settings/describe", {})
  const mpdDescriptor = findNamespaceDescriptor(describeCall.result, NS)
  const describeShape = describeCall.result === null || describeCall.result === undefined ? "null" : (Array.isArray(describeCall.result) ? "array[" + String(describeCall.result.length) + "]" : Object.keys(describeCall.result).join(","))
  const described = KNOB.reduce((acc, part) => (acc === null || acc === undefined ? undefined : acc[part]), mpdDescriptor?.value)
  say("[read-back] settings/describe: status=" + String(describeCall.status) + " envelope=" + describeShape + " ns=" + String(mpdDescriptor?.ns ?? "MISSING") + " resolved=" + JSON.stringify(described) + " base=" + JSON.stringify(mpdDescriptor?.base))
  const writeObserved = {
    describedValue: described,
    describedBase: mpdDescriptor?.base,
    mode: "write",
    mutate: mutateOutcome(mutateOne, VALUE_WRITE),
    expectedValue: VALUE_WRITE,
    initialValue: VALUE_INITIAL,
    fileBefore: beforeWrite,
    fileAfter: afterWrite,
    log: mainBoot.readLog(),
  }
  result.boots.write = { file: one.file, value: VALUE_WRITE, initialValue: VALUE_INITIAL, fileBefore: beforeWrite, fileAfter: afterWrite, mutate: mutateOne.result, describeStatus: describeCall.status, describeEnvelope: describeShape, describeNamespace: mpdDescriptor?.ns }
  result.verdicts.write = evaluateBridge(writeObserved)
  say("[write] " + result.verdicts.write.checks.map((check) => check.id + (check.ok ? "=ok" : "=FAIL")).join(" "))

  // second live root -> the target becomes ambiguous and NOTHING may be written
  const sessionTwo = await createSession(PORT_MAIN, mainBoot.cookie, two.ws)
  say("[session] two: status=" + String(sessionTwo.status) + " transport=" + String(sessionTwo.transport ?? "none"))
  await sleep(3000)
  const oneBefore = readFileSync(one.file, "utf8")
  const twoBefore = readFileSync(two.file, "utf8")
  const mutateTwo = await rpc(PORT_MAIN, mainBoot.cookie, "settings/mutate", { ns: NS, ops: [{ op: "set", path: KNOB, value: VALUE_AMBIGUOUS }] })
  say("[mutate] two roots: status=" + String(mutateTwo.status) + " " + JSON.stringify(mutateTwo.error ?? mutateTwo.transport ?? "ok"))
  await sleep(2500)
  const ambiguousObserved = {
    mode: "ambiguous",
    mutate: mutateOutcome(mutateTwo, VALUE_AMBIGUOUS),
    roots: [one.ws, two.ws],
    files: [{ before: oneBefore, after: readFileSync(one.file, "utf8") }, { before: twoBefore, after: readFileSync(two.file, "utf8") }],
    log: mainBoot.readLog(),
  }
  result.boots.ambiguous = { roots: [one.ws, two.ws], files: ambiguousObserved.files, mutate: mutateTwo.result }
  result.verdicts.ambiguous = evaluateBridge(ambiguousObserved)
  say("[ambiguous] " + result.verdicts.ambiguous.checks.map((check) => check.id + (check.ok ? "=ok" : "=FAIL")).join(" "))
  await stop(mainBoot.child)
  writeFileSync(join(outDir, "raw", "boot-main.log"), redact(mainBoot.readLog()))
  try {
    assertSessionsSandboxed(main.home, main.sandbox, { label: LANE_SLUG })
    result.isolation.sessionsSandboxed = true
  } catch (error) {
    result.isolation.sessionsSandboxed = false
    result.notes.push("workspace isolation assertion failed: " + String(error?.message ?? error))
  }

  // ── boot 2: the A6 negative control (write-back disabled from the composition) ──
  const control = makeSandbox("disabled")
  const controlWs = workspace(control, "ws-one")
  const logControl = join(outDir, "raw", "boot-disabled.log")
  const PORT_CONTROL = await freePort()
  result.ports.control = PORT_CONTROL
  say("[boot] disabled control: " + control.sandbox + " (port " + String(PORT_CONTROL) + ")")
  const controlBoot = await boot(control, logControl, PORT_CONTROL)
  const controlSession = await createSession(PORT_CONTROL, controlBoot.cookie, controlWs.ws)
  say("[session] disabled control: status=" + String(controlSession.status) + " transport=" + String(controlSession.transport ?? "none"))
  await sleep(3000)
  const controlBefore = readFileSync(controlWs.file, "utf8")
  const mutateControl = await rpc(PORT_CONTROL, controlBoot.cookie, "settings/mutate", { ns: NS, ops: [{ op: "set", path: KNOB, value: VALUE_WRITE }] })
  say("[mutate] disabled control: status=" + String(mutateControl.status) + " " + JSON.stringify(mutateControl.error ?? mutateControl.transport ?? "ok"))
  await sleep(2500)
  const controlAfter = readFileSync(controlWs.file, "utf8")
  result.boots.disabled = { file: controlWs.file, fileBefore: controlBefore, fileAfter: controlAfter, mutate: mutateControl.result }
  result.verdicts.disabled = evaluateBridge({ mode: "disabled", mutate: mutateOutcome(mutateControl, VALUE_WRITE), fileBefore: controlBefore, fileAfter: controlAfter, log: controlBoot.readLog() })
  say("[disabled] " + result.verdicts.disabled.checks.map((check) => check.id + (check.ok ? "=ok" : "=FAIL")).join(" "))
  await stop(controlBoot.child)
  writeFileSync(join(outDir, "raw", "boot-disabled.log"), redact(controlBoot.readLog()))

  // ── the recorded negative control: the engine must go RED on an injected fault ──
  const controlCopy = JSON.parse(JSON.stringify(ambiguousObserved))
  controlCopy.files[1].after = fixture(VALUE_AMBIGUOUS)
  const controlVerdict = evaluateBridge(controlCopy)
  result.controls = {
    ...result.controls,
    injectedFault: "the second live root's file changed (a fan-out)",
    verdictGoesRed: controlVerdict.ok === false,
    checks: controlVerdict.checks,
  }
  say("[negative control] injected fan-out fault -> verdict " + (controlVerdict.ok ? "GREEN (INVALID)" : "red as required"))

  const allVerdicts = [result.verdicts.write, result.verdicts.ambiguous, result.verdicts.disabled, staticVerdict]
  result.ok = allVerdicts.every((verdict) => verdict.ok) && w2Checks.every((check) => check.ok) && result.controls.verdictGoesRed === true && result.controls.sectionShape.verdictGoesRed === true && result.isolation.sessionsSandboxed === true
  result.elapsedMs = Date.now() - started
  result.notes.push("A green run proves: the front door accepted the write, the ONE live workspace file changed with comments/order intact, the log reported writtenTo + applies:'restart', two live roots refused with both candidates and wrote nothing, and the writeBack:false composition left the file byte-identical.")
  result.notes.push("It does NOT prove: the TUI keystroke path (not driven here — no TTY) or the RENDERED web surface (no browser; W3 NOT-CLAIMED). It DOES prove W2: the built/served client mounts its own top-level `settings.section` LIST slot (id \"mpd\", order 20, locale \"mpdSettings\") for namespace `mpd`, with the mount deferred behind ctx.inject, and the pre-move `settings.plugin.item` card slot is GONE.")
  result.notes.push("The W2 checks carry their own measured negative control: the PRE-MOVE card registration is re-injected into the REAL built bytes and W2a/W2b must redden (controls.sectionShape.redChecks); a mutation that does not land is recorded as void and fails the run.")
  // The RAW lane stdout and the raw control reading, next to result.json + output.log.
  writeFileSync(join(outDir, "raw", "lane-output.txt"), lines.join("\n") + "\n")
  writeFileSync(join(outDir, "raw", "card-shape-control.json"), JSON.stringify({ control: result.controls.sectionShape.control, mutationLanded: result.controls.sectionShape.mutationLanded, flippedChecks: result.controls.sectionShape.flippedChecks, greenChecks: result.controls.sectionShape.greenChecks, redChecks: result.controls.sectionShape.redChecks }, null, 2) + "\n")
  writeEvidence(outDir, result, lines.join("\n"))
  say("[" + LANE_SLUG + "] " + (result.ok ? "PASS" : "FAIL") + " -> " + relative(REPO, outDir))
  if (!keep) {
    for (const dir of [main.sandbox, control.sandbox]) {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }
  return result.ok ? 0 : 1
}
