#!/usr/bin/env bun
// web-card-catalog lane — STEP 2: boot the SANDBOX web host, capture its launch-token URL, and run
// MEASUREMENT A (the served client bytes) plus the host-side half of MEASUREMENT C (the
// `session/modelCatalog` RPC the app's own model picker calls).
//
// Nothing here touches the user's live host: DSH_HOME, HOME and cwd all point inside
// `<evidence>/sandbox`. The real `~/.dsh` is read at sandbox-build time only (step 1).
//
// Usage: bun step2-host-bytes.mjs [--hold <seconds>]   (default hold: 0 = exit after measuring)
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, join, resolve } from "node:path"
import { spawn } from "node:child_process"

const EVID = resolve(dirname(new URL(import.meta.url).pathname), ".")
const SAND = join(EVID, "sandbox")
const DSH_HOME = join(SAND, "dsh-home")
const USER_HOME = join(SAND, "user-home")
const WS = join(SAND, "workspace")
const RAW = join(EVID, "raw")
const REPO = resolve(EVID, "../../..")
const ARTIFACT = join(REPO, "packages", "mpd-bundle-plugin", "client.js")
const holdIndex = process.argv.indexOf("--hold")
const HOLD_MS = holdIndex === -1 ? 0 : Number(process.argv[holdIndex + 1] ?? "0") * 1000
const sha = (text) => createHash("sha256").update(text).digest("hex")
const say = (line) => { const text = "[host] " + line; console.log(text); appendLog(text) }
const LOG = join(EVID, "output.log")
function appendLog(text) {
  try { appendFileSync(LOG, text + "\n") } catch { /* best effort */ }
}

function freePort() {
  return new Promise((done) => {
    const server = createServer()
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      server.close(() => done(port))
    })
  })
}

// ── isolation assertion, before anything is started ───────────────────────────────────────────
const realHome = join(process.env.HOME_REAL ?? "/root", ".dsh")
for (const [name, value] of Object.entries({ DSH_HOME, HOME: USER_HOME, workspace: WS })) {
  if (!value.startsWith(SAND)) throw new Error("isolation assertion: " + name + " not inside the sandbox: " + value)
}
if (DSH_HOME.startsWith(realHome)) throw new Error("isolation assertion: DSH_HOME under the real home")

const result = {
  step: "host-bytes",
  sandbox: SAND,
  roots: { DSH_HOME, HOME: USER_HOME, workspace: WS },
  isolation: { allInsideSandbox: true, noneUnderRealHome: true },
  repoArtifact: { path: "packages/mpd-bundle-plugin/client.js" },
}

const port = await freePort()
result.port = port
const bootLog = join(RAW, "host-boot.log")
rmSync(bootLog, { force: true })
const fd = openSync(bootLog, "a")
const child = spawn("dsh", ["--profile", "web", "--port", String(port), "--no-open"], {
  env: { ...process.env, DSH_HOME, HOME: USER_HOME },
  cwd: WS,
  stdio: ["ignore", fd, fd],
})
result.pid = child.pid
say("boot pid=" + String(child.pid) + " port=" + String(port) + " log=" + bootLog)

const base = "http://127.0.0.1:" + String(port)
let cookie = ""
let token = ""
const readBootLog = () => { try { return readFileSync(bootLog, "utf8") } catch { return "" } }

try {
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 1500))
    const log = readBootLog()
    if (/EADDRINUSE/.test(log)) throw new Error("boot could not listen on " + String(port) + " (EADDRINUSE)")
    const match = /token=([A-Za-z0-9_-]+)/.exec(log)
    if (match !== null) token = match[1]
    if (token === "") {
      if (child.exitCode !== null && child.exitCode !== undefined) {
        throw new Error("the boot exited early with code " + String(child.exitCode) + "; log tail: " + log.split("\n").slice(-6).join(" | "))
      }
      continue
    }
    try {
      const authorize = await fetch(base + "/?token=" + token, { redirect: "manual", signal: AbortSignal.timeout(8000) })
      cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ") || cookie
      const root = await fetch(base + "/", { headers: cookie === "" ? {} : { cookie }, signal: AbortSignal.timeout(8000) })
      if (cookie !== "" && root.status === 200) break
    } catch { /* not serving yet */ }
  }
  if (token === "") throw new Error("the boot never printed a launch token within 180 s")
  // The token URL is a CREDENTIAL: it is recorded redacted, and it is the line the browser stage
  // reads back out of this file.
  const bootLine = /dsh web: (\S+)/.exec(readBootLog())?.[1] ?? ""
  result.launch = {
    tokenUrlRedacted: bootLine.replace(/token=[A-Za-z0-9_-]+/, "token=<redacted>"),
    tokenLength: token.length,
    cookieObtained: cookie !== "",
  }
  // The browser stage needs the token; it lives ONLY under sandbox/ (gitignored), never in evidence.
  writeFileSync(join(SAND, "launch.json"), JSON.stringify({ port, token, cookie, base, workspace: WS }, null, 2) + "\n")
  say("launch token captured (url " + result.launch.tokenUrlRedacted + ")")

  // ── MEASUREMENT A: the SERVED client bytes ───────────────────────────────────────────────────
  const artifactText = readFileSync(ARTIFACT, "utf8")
  result.repoArtifact.bytes = Buffer.byteLength(artifactText)
  result.repoArtifact.sha256 = sha(artifactText)
  result.repoArtifact.markers = {
    'inject(["modelDirectories"': (artifactText.match(/inject\(\["modelDirectories"/g) ?? []).length,
    "data-mpd-catalog-state": (artifactText.match(/data-mpd-catalog-state/g) ?? []).length,
    'ctx.get("modelDirectories")': (artifactText.match(/ctx\.get\("modelDirectories"\)/g) ?? []).length,
    SETTINGS_KNOBS: (artifactText.match(/SETTINGS_KNOBS/g) ?? []).length,
  }

  const html = await (await fetch(base + "/", { headers: cookie === "" ? {} : { cookie } })).text()
  writeFileSync(join(RAW, "app-index.html"), html)
  const urls = [...new Set([...html.matchAll(/\/plugins\/[^\s"'<>\\]*client\.js[^\s"'<>\\]*/g)].map((match) => match[0]))]
  result.clientUrls = urls
  const mpdUrls = urls
    .filter((url) => decodeURIComponent(url).includes("@mpd-dsh/mpd"))
    .sort((left, right) => Number(left.includes(",@")) - Number(right.includes(",@")))
  result.mpdClientUrls = mpdUrls
  const fetched = []
  for (const url of mpdUrls) {
    const response = await fetch(base + url, { headers: cookie === "" ? {} : { cookie } })
    const body = await response.text()
    const isCombo = url.includes(",@")
    fetched.push({ url, isCombo, status: response.status, bytes: Buffer.byteLength(body), sha256: sha(body), body })
    if (!isCombo && response.status === 200) writeFileSync(join(RAW, "served-client.js"), body)
    if (isCombo && response.status === 200) writeFileSync(join(RAW, "served-client-combo.js"), body)
  }
  const served = fetched.find((entry) => entry.status === 200 && !entry.isCombo) ?? fetched.find((entry) => entry.status === 200)
  if (served === undefined) throw new Error("the served @mpd-dsh/mpd client bundle could not be fetched: " + JSON.stringify(fetched.map(({ body, ...rest }) => rest)))
  const body = served.body
  result.servedClient = {
    url: served.url,
    isCombo: served.isCombo,
    status: served.status,
    bytes: served.bytes,
    sha256: served.sha256,
    identicalToRepoArtifact: served.sha256 === result.repoArtifact.sha256,
    markers: {
      'inject(["modelDirectories"': (body.match(/inject\(\["modelDirectories"/g) ?? []).length,
      "data-mpd-catalog-state": (body.match(/data-mpd-catalog-state/g) ?? []).length,
      'ctx.get("modelDirectories")': (body.match(/ctx\.get\("modelDirectories"\)/g) ?? []).length,
      SETTINGS_KNOBS: (body.match(/SETTINGS_KNOBS/g) ?? []).length,
    },
    allFetched: fetched.map(({ body: _body, ...rest }) => rest),
  }
  result.servedClient.markerVerdict = {
    carriesLiveInjectMarker: result.servedClient.markers['inject(["modelDirectories"'] > 0,
    carriesCatalogStateAttr: result.servedClient.markers["data-mpd-catalog-state"] > 0,
    retiredCtxGetProbeAbsent: result.servedClient.markers['ctx.get("modelDirectories")'] === 0,
    settingsKnobsAbsent: result.servedClient.markers.SETTINGS_KNOBS === 0,
  }
  say("served client: " + String(served.bytes) + " bytes sha=" + served.sha256.slice(0, 16) + " markers=" + JSON.stringify(result.servedClient.markers) + " identicalToRepo=" + String(result.servedClient.identicalToRepoArtifact))

  // ── MEASUREMENT C (host side): the app's own catalog RPC ─────────────────────────────────────
  const rpc = async (method, args) => {
    const response = await fetch(base + "/api/" + method.split("/").join("/"), {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
      body: JSON.stringify({ type: "client-request", rpcId: "catalog-lane-" + method.replace("/", "-") + "-" + String(Date.now()), method, payload: { args } }),
      signal: AbortSignal.timeout(60000),
    }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
    const envelope = await response.json().catch(() => ({}))
    return { status: response.status, result: envelope?.result ?? null, error: envelope?.error ?? null, transport: envelope?.transport ?? null }
  }

  const catalogCall = await rpc("session/modelCatalog", {})
  const catalogValue = catalogCall.result?.value ?? catalogCall.result ?? null
  const groups = Array.isArray(catalogValue?.groups) ? catalogValue.groups : []
  const summarise = (list) => list.map((group) => ({
    id: group?.id ?? null,
    name: group?.name ?? null,
    models: Array.isArray(group?.models) ? group.models.length : 0,
    modelIds: Array.isArray(group?.models) ? group.models.map((model) => model?.id ?? null).slice(0, 40) : [],
  }))
  result.hostCatalogRpc = {
    method: "session/modelCatalog",
    status: catalogCall.status,
    error: catalogCall.error,
    transport: catalogCall.transport,
    ok: catalogCall.result?.ok ?? null,
    routableProviders: catalogValue?.routableProviders ?? null,
    failures: catalogValue?.failures ?? null,
    providerCount: groups.length,
    modelCount: groups.reduce((total, group) => total + (Array.isArray(group?.models) ? group.models.length : 0), 0),
    groups: summarise(groups),
    rawEnvelopeKeys: catalogCall.result === null || catalogCall.result === undefined ? null : Object.keys(catalogCall.result),
  }
  say("host RPC session/modelCatalog: status=" + String(catalogCall.status) + " providers=" + String(result.hostCatalogRpc.providerCount) + " models=" + String(result.hostCatalogRpc.modelCount) + " " + JSON.stringify(result.hostCatalogRpc.groups.map((group) => group.id + ":" + String(group.models))))
  writeFileSync(join(RAW, "host-catalog-rpc.json"), JSON.stringify(result.hostCatalogRpc, null, 2) + "\n")

  // ── a live session, so the card's binding has a "current" session to bind to ────────────────
  const sessionCall = await rpc("session/create", { request: { cwd: WS, agentPreset: "mpd" } })
  const sessionId = sessionCall.result?.sessionId ?? sessionCall.result?.id ?? sessionCall.result?.value?.sessionId ?? null
  result.session = { status: sessionCall.status, sessionId, error: sessionCall.error }
  say("session/create: status=" + String(sessionCall.status) + " id=" + String(sessionId))
  const listCall = await rpc("session/list", {})
  const listValue = listCall.result?.value ?? listCall.result ?? null
  result.sessionList = {
    status: listCall.status,
    keys: listValue === null || listValue === undefined ? null : Object.keys(listValue),
    current: listValue?.current ?? null,
    count: Array.isArray(listValue?.sessions) ? listValue.sessions.length : null,
  }
  say("session/list: " + JSON.stringify(result.sessionList).slice(0, 300))

  // How many sessions are on disk, and are they SANDBOXED (no real-workspace project key)?
  const sessionRoot = join(DSH_HOME, "sessions")
  const projectKeys = existsSync(sessionRoot) ? readdirSync(sessionRoot) : []
  result.sessionsOnDisk = { root: sessionRoot.replace(SAND, "<sandbox>"), projectKeys, sandboxed: projectKeys.every((key) => !key.includes("--dshProj-my-power-dsh--")) }

  {
    const log = readBootLog()
    result.bootFaults = ["did not activate", "Failed to load plugins", "plugin tree failed to load", "failed to apply loader entry", "pending (waiting for service"].filter((needle) => log.includes(needle))
    result.bootLogLines = log.split("\n").length
    result.bootLogTailRedacted = log.split("\n").slice(-14).join("\n").replace(/token=[A-Za-z0-9_-]+/g, "token=<redacted>")
  }
  result.ok = true
  if (HOLD_MS > 0) {
    say("holding the host for " + String(HOLD_MS / 1000) + " s (browser stage may attach)")
    await new Promise((done) => setTimeout(done, HOLD_MS))
  }
} catch (error) {
  result.ok = false
  result.error = String(error?.message ?? error)
  say("FAILED: " + result.error)
} finally {
  try { child.kill("SIGTERM") } catch { /* already gone */ }
  await new Promise((done) => setTimeout(done, 1500))
  try { child.kill("SIGKILL") } catch { /* already gone */ }
  mkdirSync(RAW, { recursive: true })
  writeFileSync(join(RAW, "step2-host-bytes.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(JSON.stringify({ ok: result.ok, error: result.error ?? null, port: result.port, servedClient: result.servedClient === undefined ? null : { bytes: result.servedClient.bytes, sha256: result.servedClient.sha256, markerVerdict: result.servedClient.markerVerdict }, hostCatalog: result.hostCatalogRpc === undefined ? null : { providers: result.hostCatalogRpc.providerCount, models: result.hostCatalogRpc.modelCount } }, null, 2))
}
process.exit(result.ok === true ? 0 : 1)
