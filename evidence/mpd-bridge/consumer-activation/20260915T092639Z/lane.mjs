#!/usr/bin/env node
// t42 lane — CONSUMER ACTIVATION: does a consumer plugin really use the bridged value after a
// restart, is the restart genuinely required, and is `<workspace>/.mpd/mpd.jsonc` the durable
// carrier?
//
// Boot/rpc/session mechanics are the measured pattern from
// `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs` (t35's lane): isolated DSH_HOME + sandbox
// HOME + sandbox WORKSPACE, a real web-profile boot of the bundle, the host's own launch-token
// cookie, then the host's own `settings/mutate` RPC — the same wire call the TUI section and any
// web card emit. What t42 adds is the CONSUMER observation (`consumer-probe.mjs`).
//
// KNOWN LIMIT, recorded rather than papered over: this environment has no model credential, so the
// consumer is observed by applying the REAL built plugin modules the host loads (config first, then
// the consumer, the host's row order) against the REAL sandbox files and invoking the REAL
// registered tool — not by a model-driven tool call inside the booted host.
//
// Usage: node lane.mjs --out <evidence-dir>
import { spawn } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(dirname(dirname(dirname(here))))
const OUT = (() => { const at = process.argv.indexOf("--out"); return at === -1 ? here : process.argv[at + 1] })()
const RAW = join(OUT, "raw")
const SB = join(OUT, "sandbox")
const WS = join(SB, "ws")
const FILE_VALUE = 30            // the FILE's value: small, so the consumer's truncation is visible
const WRITTEN_VALUE = 31415      // the value written through the host's own settings service
const KNOB = ["hashline", "maxDiffChars"]
const TARGET = join(WS, "consumer-target.txt")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const steps = []
const log = (name, text) => writeFileSync(join(RAW, name), String(text))
const record = (entry) => { steps.push(entry); console.log("[t42] " + JSON.stringify(entry)) }

const fixture = (value) => `{\n  // human comment: must survive the write-back\n  "hashline": {\n    "maxDiffChars": ${value},\n  },\n  "ulw": { "maxRounds": 6 },\n}\n`
const fileValue = () => { const m = /"maxDiffChars"\s*:\s*(\d+)/.exec(readFileSync(join(WS, ".mpd", "mpd.jsonc"), "utf8")); return m === null ? null : Number(m[1]) }

async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = createServer(); probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => { const address = probe.address(); const port = typeof address === "object" && address !== null ? address.port : 0; probe.close(() => resolve(port)) })
  })
}

function makeSandbox(tag) {
  const home = join(SB, tag === "main" ? "dshhome" : "dshhome-" + tag)
  const userHome = join(SB, "home")
  const profile = join(home, "profiles", "w")
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  for (const f of [".credentials.yaml", "settings.yaml"]) if (existsSync(join(homedir(), ".dsh", f))) copyFileSync(join(homedir(), ".dsh", f), join(home, f))
  symlinkSync(REPO, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
  writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } } }, null, 2))
  if (home.startsWith(join(homedir(), ".dsh"))) throw new Error("isolation assertion: DSH_HOME points at the real home")
  return { home, userHome, env: { ...process.env, DSH_HOME: home, HOME: userHome, DSH_WORKSPACE_ROOT: WS } }
}

async function boot(sandbox, logPath, port) {
  const fd = openSync(logPath, "w")
  const child = spawn("dsh", ["--profile", "w", "--port", String(port), "--no-open"], { env: sandbox.env, cwd: SB, stdio: ["ignore", fd, fd] })
  const readLog = () => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  let token = ""; let cookie = ""
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    await sleep(1500)
    const started = readLog()
    if (/EADDRINUSE/.test(started)) throw new Error("port " + String(port) + " in use")
    if (child.exitCode !== null && child.exitCode !== undefined && token === "") throw new Error("boot exited early (" + String(child.exitCode) + "): " + started.split("\n").slice(-5).join(" | "))
    const match = /token=([A-Za-z0-9_-]+)/.exec(started)
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

async function call(port, cookie, method, args, timeout = 60000) {
  const response = await fetch(`http://127.0.0.1:${port}/api/${method.split("/")[0]}/${method.split("/")[1]}`, {
    method: "POST", headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
    body: JSON.stringify({ type: "client-request", rpcId: "t42-" + method.replace("/", "-") + "-" + String(Date.now()), method, payload: { args } }),
    signal: AbortSignal.timeout(timeout),
  }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
  const envelope = await response.json().catch(() => ({}))
  return { status: response.status, result: envelope?.result ?? null, error: envelope?.error ?? null, transport: envelope?.transport ?? null }
}

async function stop(child) { try { child.kill("SIGTERM") } catch { /* gone */ } await sleep(2500); try { child.kill("SIGKILL") } catch { /* gone */ } }

// ── the consumer observation, in a child process so "restart" means a fresh process ──────────────
function runProbe({ tag, hold, dshHome }) {
  const jsonPath = join(RAW, "probe-" + tag + ".json")
  const logPath = join(RAW, "probe-" + tag + ".log")
  const args = [join(here, "consumer-probe.mjs"), "--ws", WS, "--target", TARGET, "--json", jsonPath]
  if (hold !== undefined) args.push("--hold", hold)
  const fd = openSync(logPath, "w")
  const env = { ...process.env, DSH_HOME: dshHome, DSH_WORKSPACE_ROOT: WS }
  const child = spawn(process.execPath, args, { env, cwd: SB, stdio: ["ignore", fd, fd] })
  return { child, jsonPath, logPath, done: new Promise((resolve) => child.on("exit", () => resolve(readJson(jsonPath)))) }
}
function readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")) } catch { return null } }

const main = async () => {
  mkdirSync(join(WS, ".mpd"), { recursive: true }); mkdirSync(RAW, { recursive: true })
  writeFileSync(join(WS, ".mpd", "mpd.jsonc"), fixture(FILE_VALUE))
  writeFileSync(TARGET, Array.from({ length: 40 }, (_, i) => "line " + String(i + 1)).join("\n") + "\n")
  record({ step: "fixture", ws: WS, target: TARGET, fileValue: fileValue(), note: "the FILE layer (L2) carries the small value; the consumer truncates its diff to it" })

  const sandbox = makeSandbox("main")
  const port = await freePort()
  const bootLog = join(RAW, "boot-main.log")
  const host = await boot(sandbox, bootLog, port)
  record({ step: "boot", port, token: host.token !== "", cookie: host.cookie !== "", dshHome: sandbox.home, log: "raw/boot-main.log" })

  const session = await call(port, host.cookie, "session/create", { request: { cwd: WS, agentPreset: "mpd" } })
  record({ step: "session-create", status: session.status, liveRoot: WS, rawResult: session.result, error: session.error ?? null })
  await sleep(3000)

  // (1) the consumer BEFORE any change — a process that will be held open across the write
  const trigger = join(RAW, "trigger-after-write")
  const heldProbe = runProbe({ tag: "held-before-write", hold: trigger, dshHome: sandbox.home })
  await sleep(4000)
  const heldFirst = readJson(heldProbe.jsonPath)
  record({ step: "consumer-before-write", probe: heldFirst?.steps?.find((s) => s.phase === "first-observation") ?? null, pid: heldFirst?.steps?.[0]?.pid ?? null, heldJsonWhileRunning: heldFirst !== null })

  // (2) the write, through the HOST's own settings service
  const mutate = await call(port, host.cookie, "settings/mutate", { ns: "mpd", ops: [{ op: "set", path: KNOB, value: WRITTEN_VALUE }] })
  await sleep(6000)
  const fileAfter = fileValue()
  const fileBytes = readFileSync(join(WS, ".mpd", "mpd.jsonc"), "utf8")
  log("boot-main.log", host.readLog())
  const bridgeLines = host.readLog().split("\n").filter((line) => line.includes("[mpd-config] settings bridge") || line.includes("writtenTo"))
  record({ step: "settings-mutate", status: mutate.status, rawResult: mutate.result, error: mutate.error ?? null, fileValueAfter: fileAfter, fileBytes: fileBytes.replace(/\n/g, "\\n"), bridgeLines })

  // (3) the NEGATIVE CONTROL: same process, no restart → the consumer must still hold the OLD value
  writeFileSync(trigger, "go\n")
  const heldFinal = await heldProbe.done
  record({ step: "consumer-same-process-after-write", steps: heldFinal?.steps ?? null })

  await stop(host.child)
  record({ step: "restart", note: "the host process is gone; the next consumer observation is a fresh process" })

  // (4) the RESTART: a fresh consumer process must carry the NEW value
  const restarted = await runProbe({ tag: "after-restart", dshHome: sandbox.home }).done
  record({ step: "consumer-after-restart", steps: restarted?.steps ?? null })

  // (5) DURABILITY: a FRESH DSH_HOME (no settings leaf) resolving from the file alone
  const freshHome = join(SB, "dshhome-fresh")
  mkdirSync(freshHome, { recursive: true })
  const fresh = await runProbe({ tag: "fresh-home-file-only", dshHome: freshHome }).done
  record({ step: "consumer-fresh-home-file-only", dshHome: freshHome, steps: fresh?.steps ?? null })

  const verdict = {
    fileLayerCarriesWrittenValue: fileAfter === WRITTEN_VALUE,
    commentsAndTrailingCommaIntact: fileBytes.includes("// human comment") && fileBytes.includes('"maxDiffChars": ' + String(WRITTEN_VALUE) + ","),
    consumerBeforeWrite: (heldFirst ?? heldFinal)?.steps?.find((s) => s.phase === "first-observation")?.consumerDiffLength ?? null,
    consumerSameProcessAfterWrite: heldFinal?.steps?.find((s) => s.phase === "same-process-re-invocation")?.consumerDiffLength ?? null,
    consumerSameProcessConfigLayerAfterWrite: heldFinal?.steps?.find((s) => s.phase === "after-external-change-same-process")?.configLayerValue ?? null,
    consumerAfterRestart: restarted?.steps?.find((s) => s.phase === "first-observation")?.consumerDiffLength ?? null,
    consumerFreshHomeFileOnly: fresh?.steps?.find((s) => s.phase === "first-observation")?.consumerDiffLength ?? null,
    freshHomeConfigLayerValue: fresh?.steps?.find((s) => s.phase === "first-observation")?.configLayerValue ?? null,
  }
  verdict.consumerUsesNewValueAfterRestart = verdict.consumerAfterRestart !== null && verdict.consumerAfterRestart > FILE_VALUE
  verdict.restartIsGenuinelyRequired = verdict.consumerSameProcessAfterWrite === FILE_VALUE && verdict.consumerSameProcessConfigLayerAfterWrite === WRITTEN_VALUE
  verdict.fileIsDurableCarrier = verdict.fileLayerCarriesWrittenValue && verdict.consumerFreshHomeFileOnly !== null && verdict.consumerFreshHomeFileOnly > FILE_VALUE
  writeFileSync(join(OUT, "result.json"), JSON.stringify({ ok: true, fileValue: FILE_VALUE, writtenValue: WRITTEN_VALUE, verdict, steps }, null, 2) + "\n")
  record({ step: "verdict", verdict })
}

await main()
