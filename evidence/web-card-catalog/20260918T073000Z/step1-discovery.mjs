#!/usr/bin/env bun
// web-card-catalog/20260918T073000Z — MEASUREMENT 1: the REAL live-session discovery path.
//
// Drives a sandbox host + a real Chromium over CDP and records, from the page:
//   M1  the client `sessions` service surface reachable from the settings card's OWN caller-scoped
//       ctx (own+prototype keys, every item's typeof) and the exact shape of `list.getSnapshot()`;
//   M2  which snapshot field carries a session id, and for each candidate whether `scope(id)` and
//       `binding(id)` resolve — the resolver's own precondition;
//   M3  a live `directoryFor(id)` probe (store status + per-group model counts).
//
// NAVIGATION IS THE APP'S OWN: no client store is written by this driver. The sandbox workspace is
// registered through the host's `workspace/create` RPC — the same verb the app's folder picker
// ends in — and the app's own `ui-workspace` navigation policy then creates and OPENS a session
// (`watchNavigation` -> `connectWorkspace` -> `sessions.open`). This is the difference from the
// superseded lane, which injected `sessions.list.set({current})` directly.
//
// Isolation: DSH_HOME + HOME + the workspace all live inside <evidence>/sandbox (gitignored).
import { appendFileSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { attachToPage } from "./cdp.mjs"

const EVID = resolve(dirname(new URL(import.meta.url).pathname), ".")
const SAND = join(EVID, "sandbox")
const DSH_HOME = join(SAND, "dsh-home")
const USER_HOME = join(SAND, "user-home")
const WS = join(SAND, "workspace")
const RAW = join(EVID, "raw")
const CHROME = process.env.MPD_QA_CHROME ?? "/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome"
const LOG = join(EVID, "step1.log")
const say = (line) => { const text = "[step1] " + line; console.log(text); try { appendFileSync(LOG, text + "\n") } catch { /* best effort */ } }
mkdirSync(RAW, { recursive: true })

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const redact = (text) => String(text).replace(/token=[A-Za-z0-9_-]+/g, "token=<redacted>")
const result = { step: "discovery", roots: { DSH_HOME, HOME: USER_HOME, workspace: WS }, measurements: {}, console: {}, error: null }

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

/** Open the settings dialog and click the MPD nav entry — this MOUNTS the card, so its dynamic
 *  injection fires and the probe captures the caller-scoped ctx the card really uses. */
const OPEN_SETTINGS = `(() => {
  const all = [...document.querySelectorAll('button, [role="button"], [role="menuitem"], a')];
  const trigger = all.find((el) => el.getAttribute('aria-label') === 'Settings') ?? all.find((el) => /settings/i.test(el.getAttribute('aria-label') ?? '') || /settings/i.test((el.textContent || '').trim()));
  if (trigger === undefined) return { clicked: false, candidates: all.length };
  trigger.scrollIntoView({ block: 'center' });
  trigger.click();
  return { clicked: true, text: (trigger.textContent || '').trim().slice(0, 40), ariaLabel: trigger.getAttribute('aria-label') };
})()`

const CLICK_MPD_NAV = `(() => {
  const leaves = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && (el.textContent || '').trim() === 'MPD');
  const visible = leaves.find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const target = visible ?? leaves[0] ?? null;
  if (target === null) return { clicked: false, leafCandidates: leaves.length };
  const clickable = target.closest('button,[role="menuitem"],[role="tab"],a,li') ?? target;
  clickable.scrollIntoView({ block: 'center' });
  clickable.click();
  return { clicked: true, tag: clickable.tagName, text: (clickable.textContent || '').trim().slice(0, 40) };
})()`

const CARD_READ = `(() => {
  const status = document.querySelector('[data-mpd-catalog-state]');
  if (status === null) return { found: false };
  const attrs = {};
  for (const attribute of status.attributes) attrs[attribute.name] = attribute.value;
  return { found: true, statusText: (status.textContent ?? '').trim(), catalogAttributes: attrs };
})()`

const hostPort = await freePort()
const bootLog = join(RAW, "step1-host-boot.log")
const bootFd = openSync(bootLog, "a")
const host = spawn("dsh", ["--profile", "web", "--port", String(hostPort), "--no-open"], {
  env: { ...process.env, DSH_HOME, HOME: USER_HOME },
  cwd: WS,
  stdio: ["ignore", bootFd, bootFd],
})
const base = "http://127.0.0.1:" + String(hostPort)
let chrome = null
let session = null
const consoleEvents = []
try {
  say("host boot pid=" + String(host.pid) + " port=" + String(hostPort))
  const readBootLog = () => { try { return readFileSync(bootLog, "utf8") } catch { return "" } }
  const rpc = async (method, args, cookie) => {
    const response = await fetch(base + "/api/" + method, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
      body: JSON.stringify({ type: "client-request", rpcId: "mpd-m1-" + String(Date.now()), method, payload: { args } }),
      signal: AbortSignal.timeout(60000),
    }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
    const envelope = await response.json().catch(() => ({}))
    return { status: response.status, result: envelope?.result ?? null, error: envelope?.error ?? null }
  }

  let cookie = ""
  let token = ""
  {
    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
      await sleep(1200)
      const match = /token=([A-Za-z0-9_-]+)/.exec(readBootLog())
      if (match !== null) token = match[1]
      if (token === "") continue
      try {
        const authorize = await fetch(base + "/?token=" + token, { redirect: "manual", signal: AbortSignal.timeout(8000) })
        cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ") || cookie
        const root = await fetch(base + "/", { headers: cookie === "" ? {} : { cookie }, signal: AbortSignal.timeout(8000) })
        if (cookie !== "" && root.status === 200) break
      } catch { /* not serving yet */ }
    }
    if (token === "") throw new Error("the sandbox host never printed a launch token within 180 s")
  }
  say("host serving; launch token read from the boot log (redacted=" + String(redact("token=" + token) === "token=<redacted>") + ")")

  // ── STEP 1: register the sandbox workspace through the HOST's own API ───────────────────────
  // `workspace/create` is the verb the app's folder picker ends in (`ctx.remote.workspace.create`).
  // Registering a workspace is what makes the app's OWN navigation policy open a session.
  const created = await rpc("workspace/create", { path: WS }, cookie)
  const workspaceId = created.result?.value?.workspace?.workspaceId ?? created.result?.workspace?.workspaceId ?? null
  result.measurements.workspaceCreate = { rpcStatus: created.status, workspaceId, created: created.result?.value?.created ?? created.result?.created ?? null, error: created.error === null ? null : String(created.error?.code ?? created.error) }
  say("WORKSPACE create: " + JSON.stringify(result.measurements.workspaceCreate))

  // ── STEP 2: a REAL session through the host API with an explicit sandbox cwd ────────────────
  const sessionCreate = await rpc("session/create", { request: { cwd: WS, agentPreset: "mpd" } }, cookie)
  const hostSessionId = sessionCreate.result?.value?.sessionId ?? sessionCreate.result?.sessionId ?? null
  result.measurements.hostSessionCreate = { rpcStatus: sessionCreate.status, sessionId: hostSessionId, error: sessionCreate.error === null ? null : String(sessionCreate.error?.code ?? sessionCreate.error) }
  say("HOST session create: " + JSON.stringify(result.measurements.hostSessionCreate))

  // ── STEP 3: a real Chromium with the measurement probe installed pre-document ────────────────
  const chromePort = await freePort()
  const chromeProfile = join(SAND, "chromium-profile-m1")
  const chromeFd = openSync(join(RAW, "step1-chromium.log"), "a")
  chrome = spawn(CHROME, [
    "--headless", "--remote-debugging-port=" + String(chromePort), "--no-sandbox", "--disable-setuid-sandbox",
    "--disable-gpu", "--disable-dev-shm-usage", "--remote-allow-origins=*", "--no-first-run",
    "--no-default-browser-check", "--hide-scrollbars", "--window-size=1680,1050",
    "--user-data-dir=" + chromeProfile, "about:blank",
  ], { stdio: ["ignore", chromeFd, chromeFd] })
  const attached = await attachToPage(chromePort, { timeoutMs: 30000, log: say })
  session = attached.session
  await session.send("Page.enable")
  await session.send("Runtime.enable")
  await session.send("Log.enable")
  session.on("Runtime.consoleAPICalled", (params) => consoleEvents.push({
    domain: "console." + String(params.type),
    text: (params.args ?? []).map((arg) => arg.value !== undefined ? (typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value)) : (arg.description ?? String(arg.type))).join(" "),
  }))
  session.on("Runtime.exceptionThrown", (params) => consoleEvents.push({ domain: "exception", text: String(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "") }))
  session.on("Log.entryAdded", (params) => consoleEvents.push({ domain: "log." + String(params.entry?.level), text: String(params.entry?.text ?? "") }))

  const hookSource = readFileSync(join(EVID, "probe-hook.js"), "utf8")
  await session.send("Page.addScriptToEvaluateOnNewDocument", { source: hookSource })
  await session.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false })
  await session.send("Page.navigate", { url: base + "/?token=" + encodeURIComponent(token) })
  await session.waitFor("document.querySelectorAll('button[aria-haspopup=\"dialog\"]').length > 0", { timeoutMs: 90000, label: "app hydration" })
  say("app hydrated")
  await sleep(3000)
  await session.screenshot(join(RAW, "step1-app-hydrated.png"))

  // ── the app's OWN navigation: does it open a session without any help from us? ──────────────
  const navObservation = []
  for (let tick = 0; tick < 10; tick += 1) {
    const read = await session.evaluate(`(() => {
      const probe = window.__MPD_PROBE__;
      return { at: Date.now(), hasCtx: window.__MPD_CTX__ !== undefined, url: location.href.replace(/token=[^&]+/, 'token=<redacted>'), bodySnippet: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 220) };
    })()`)
    navObservation.push(read)
    if (tick === 0) say("UI after hydrate: " + JSON.stringify(read.bodySnippet))
    await sleep(1500)
  }
  result.measurements.appBoot = navObservation

  // ── STEP 4: mount the card so the probe captures the card's OWN caller-scoped ctx ────────────
  const open = await session.evaluate(OPEN_SETTINGS)
  await session.waitFor("document.querySelector('[role=\"dialog\"]') !== null", { timeoutMs: 20000, label: "the settings dialog" })
  await sleep(1200)
  const nav = await session.evaluate(CLICK_MPD_NAV)
  await session.waitFor("document.querySelector('[data-mpd-catalog-state]') !== null", { timeoutMs: 25000, label: "the mpd catalog status paragraph" })
  await sleep(2500)
  result.measurements.cardMount = { open, nav, card: await session.evaluate(CARD_READ) }
  say("CARD (mounted, no injection): " + JSON.stringify(result.measurements.cardMount.card?.statusText ?? result.measurements.cardMount.card))

  // ── M1/M2/M3: the measurement ───────────────────────────────────────────────────────────────
  const measure = async (label, directoryProbe) => {
    const read = await session.evaluate(`window.__MPD_MEASURE__(${directoryProbe === true ? "true" : "false"})`)
    result.measurements[label] = read
    say(label + ": ctx=" + String(read.ctxSource) + " sessionsResolved=" + JSON.stringify(read.sessionsResolved ?? null))
    say(label + " snapshotCurrentTypeof=" + String(read.snapshotCurrentTypeof) + " raw=" + JSON.stringify(read.snapshotCurrentRaw))
    say(label + " idCandidates=" + JSON.stringify(read.idCandidates ?? null))
    say(label + " candidateResolution=" + JSON.stringify(read.candidateResolution ?? null))
    say(label + " sessionsKeys=" + JSON.stringify(read.sessionsKeys ?? null))
    say(label + " snapshotKeys=" + JSON.stringify(Object.keys(read.snapshot?.keys ?? {})))
    return read
  }
  await measure("mCardMounted", true)
  await session.screenshot(join(RAW, "step1-card-mounted.png"))

  // ── close the dialog, let the app's navigation settle, then re-open and re-measure ──────────
  for (const type of ["keyDown", "keyUp"]) {
    await session.send("Input.dispatchKeyEvent", { type, windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27, key: "Escape", code: "Escape" })
  }
  await sleep(1500)
  const settle = []
  for (let tick = 0; tick < 12; tick += 1) {
    const read = await session.evaluate(`(() => ({ at: Date.now(), url: location.href.replace(/token=[^&]+/, 'token=<redacted>'), body: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 300) }))()`)
    settle.push(read)
    await sleep(1500)
  }
  result.measurements.appSettled = settle
  say("UI after settle: " + JSON.stringify(settle[settle.length - 1]?.body ?? null))
  await session.screenshot(join(RAW, "step1-app-settled.png"))

  const open2 = await session.evaluate(OPEN_SETTINGS)
  await session.waitFor("document.querySelector('[role=\"dialog\"]') !== null", { timeoutMs: 20000, label: "the settings dialog (2)" })
  await sleep(1200)
  const nav2 = await session.evaluate(CLICK_MPD_NAV)
  await session.waitFor("document.querySelector('[data-mpd-catalog-state]') !== null", { timeoutMs: 25000, label: "the mpd catalog status paragraph (2)" })
  await sleep(3000)
  result.measurements.cardMount2 = { open: open2, nav: nav2, card: await session.evaluate(CARD_READ) }
  say("CARD (after settle): " + JSON.stringify(result.measurements.cardMount2.card?.statusText ?? result.measurements.cardMount2.card))
  await measure("mAfterSettle", true)
  await session.screenshot(join(RAW, "step1-card-after-settle.png"))

  // ── the browser's own catalog, the ground truth the card must mirror ────────────────────────
  const browserCatalog = await session.evaluate(`(async () => {
    const response = await fetch("/api/session/modelCatalog", {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ type: "client-request", rpcId: "mpd-m1-catalog", method: "session/modelCatalog", payload: { args: {} } }),
    });
    const envelope = await response.json();
    const value = envelope?.result?.value ?? envelope?.result ?? null;
    const groups = Array.isArray(value?.groups) ? value.groups : [];
    return { status: response.status, providers: groups.length, models: groups.reduce((total, group) => total + (Array.isArray(group.models) ? group.models.length : 0), 0), providerIds: groups.map((group) => group.id) };
  })()`)
  result.measurements.browserCatalog = browserCatalog
  say("BROWSER catalog: " + JSON.stringify(browserCatalog))

  const probeState = await session.evaluate(`(() => {
    const handlers = window.__MPD_INSTALL_LOADER_HOOK__;
    return { probeInstalled: window.__MPD_PROBE__ !== undefined, loaderHookInstalled: typeof handlers === 'function', mpdBundlesLoaded: (window.__MPD_PROBE__?.loaderLoadCalls ?? []).filter((entry) => String(entry.id).includes('@mpd-dsh')).map((entry) => entry.id), injectCalls: window.__MPD_PROBE__?.injectCalls ?? [], ctxCaptured: window.__MPD_PROBE__?.ctxCaptured ?? false, scopedCaptured: window.__MPD_PROBE__?.scopedCaptured ?? false, errors: window.__MPD_PROBE__?.errors ?? [] };
  })()`)
  result.measurements.probeState = probeState
  say("PROBE: " + JSON.stringify({ mpdBundlesLoaded: probeState.mpdBundlesLoaded, injectCalls: probeState.injectCalls, ctxCaptured: probeState.ctxCaptured, scopedCaptured: probeState.scopedCaptured }))

  const mpdConsole = consoleEvents.filter((event) => /\[mpd\]/i.test(event.text))
  result.console = { total: consoleEvents.length, mpdPrefixed: mpdConsole }
  say("CONSOLE: total=" + String(consoleEvents.length) + " mpd=" + String(mpdConsole.length))
} catch (error) {
  result.error = String(error?.stack ?? error?.message ?? error)
  say("FAILED: " + result.error)
} finally {
  writeFileSync(join(RAW, "step1-result.json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(RAW, "step1-console.json"), JSON.stringify(consoleEvents, null, 2) + "\n")
  try { if (session !== null) await session.send("Browser.close") } catch { /* best effort */ }
  try { chrome?.kill("SIGKILL") } catch { /* best effort */ }
  try { host.kill("SIGKILL") } catch { /* best effort */ }
  await sleep(500)
  say("done error=" + String(result.error === null ? "none" : "set"))
  process.exit(result.error === null ? 0 : 1)
}
