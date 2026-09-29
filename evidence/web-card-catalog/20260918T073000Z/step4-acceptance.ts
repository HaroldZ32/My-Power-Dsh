#!/usr/bin/env bun
// web-card-catalog/20260918T073000Z — MEASUREMENT 2: the REAL live-session discovery path, with the
// app OPEN ON A SESSION.
//
// Step 1 proved the card's failure reproduces with zero injection, but left `snapshot.current`
// undefined because the sandbox app had no registered workspace — so the app's own navigation
// policy (`ui-workspace.watchNavigation`) had nothing to open. This driver closes that gap WITHOUT
// touching client state:
//   1. the sandbox workspace is registered through the HOST's `workspace/create` RPC — the verb the
//      app's own folder picker ends in (`ctx.remote.workspace.create`) — called from the PAGE after
//      hydration so the host is fully mounted, and again from Node if the page call fails;
//   2. the app's OWN navigation policy then runs: `watchNavigation` -> `recentWorkspace` ->
//      `connectWorkspace` (which itself CREATES a session) -> `sessions.open(sessionId)`;
//   3. only THEN is the card read, through `sessions.list.getSnapshot().current`, and
//      `directoryFor(current)` is probed from the CARD'S OWN scoped ctx (deps
//      ["modelDirectories","sessions","remote.session"]), not from whatever inject fired last.
//
// NO client store is written by this driver (`sessions.list.set` is never called anywhere).
import { appendFileSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { attachToPage } from "./cdp.ts"

const EVID = resolve(dirname(new URL(import.meta.url).pathname), ".")
const SAND = join(EVID, "sandbox")
const DSH_HOME = join(SAND, "dsh-home")
const USER_HOME = join(SAND, "user-home")
const WS = join(SAND, "workspace")
const RAW = join(EVID, "raw")
const CHROME = process.env.MPD_QA_CHROME ?? "/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome"
const LOG = join(EVID, "step4.log")
const CARD_DEPS_KEY = JSON.stringify(["modelDirectories", "sessions", "remote.session"])
const say = (line) => { const text = "[step4] " + line; console.log(text); try { appendFileSync(LOG, text + "\n") } catch { /* best effort */ } }
mkdirSync(RAW, { recursive: true })

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const redact = (text) => String(text).replace(/token=[A-Za-z0-9_-]+/g, "token=<redacted>")
const result = { step: "live-session-discovery", roots: { DSH_HOME, HOME: USER_HOME, workspace: WS }, measurements: {}, console: {}, error: null }

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

const OPEN_SETTINGS = `(() => {
  const all = [...document.querySelectorAll('button, [role="button"], [role="menuitem"], a')];
  const trigger = all.find((el) => el.getAttribute('aria-label') === 'Settings') ?? all.find((el) => /settings/i.test(el.getAttribute('aria-label') ?? '') || /settings/i.test((el.textContent || '').trim()));
  if (trigger === undefined) return { clicked: false, candidates: all.length };
  trigger.scrollIntoView({ block: 'center' });
  trigger.click();
  return { clicked: true, text: (trigger.textContent || '').trim().slice(0, 40) };
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
  const dialog = status.closest('[role="dialog"]') ?? document;
  const selects = [...dialog.querySelectorAll('select')].map((el, index) => ({ index, ariaLabel: el.getAttribute('aria-label'), options: [...el.options].map((option) => ({ value: option.value, label: option.textContent })) }));
  return { found: true, statusText: (status.textContent ?? '').trim(), catalogAttributes: attrs, selectCount: selects.length, selects };
})()`

const ALL_SELECTS_READ = `(() => {
  const status = document.querySelector('[data-mpd-catalog-state]');
  const dialog = status === null ? document : (status.closest('[role="dialog"]') ?? document);
  return [...dialog.querySelectorAll('select')].map((select, index) => {
    let key = null; let node = select;
    for (let up = 0; up < 8 && node !== null; up += 1) {
      const text = node.parentElement === null ? "" : node.parentElement.textContent || "";
      const match = /(teamModels\\.slot[123]\\.(provider|model|reasoningEffort))/.exec(text);
      if (match !== null) { key = match[1]; break; }
      node = node.parentElement;
    }
    return { index, key, value: select.value, options: [...select.options].map((option) => ({ value: option.value, label: option.textContent })) };
  });
})()`

const hostPort = await freePort()
const bootLog = join(RAW, "step4-host-boot.log")
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
  /** The envelope is `{ type, rpcId, result: { ok, value } | { ok: false, error } }` — measured. */
  const rpc = async (method, args, cookie) => {
    const response = await fetch(base + "/api/" + method, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
      body: JSON.stringify({ type: "client-request", rpcId: "mpd-m2-" + String(Date.now()), method, payload: { args } }),
      signal: AbortSignal.timeout(60000),
    }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
    const envelope = await response.json().catch(() => ({}))
    return { status: response.status, envelope, ok: envelope?.result?.ok ?? null, value: envelope?.result?.value ?? null, error: envelope?.result?.error ?? null }
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
  say("host serving")

  // ── 0. register the sandbox workspace through the HOST API BEFORE the app boots ──────────────
  // MEASURED (step3): `ui-workspace.watchNavigation().reconcile()` latches `initial = "done"` the
  // first time the workspace list reaches `phase: "ready"` with NO workspace, and NEVER re-evaluates.
  // A workspace created after boot therefore changes nothing — the app opens no session, `current`
  // stays undefined, and no amount of waiting helps. Registering it first lets the app's OWN policy
  // run its normal path: recentWorkspace -> connectWorkspace (which creates the session) ->
  // sessions.open(). The arg shape `{ request: { path } }` is the descriptor's (step2 measured
  // `gateway/arguments-invalid … missing "request"; unexpected "path"` for the flat form).
  const bootWorkspace = await rpc("workspace/create", { request: { path: WS } }, cookie)
  result.measurements.workspaceCreateBeforeBoot = { ok: bootWorkspace.ok, error: bootWorkspace.error, workspace: bootWorkspace.value?.workspace ?? null, created: bootWorkspace.value?.created ?? null }
  say("WORKSPACE create (before boot): ok=" + String(bootWorkspace.ok) + " id=" + String(bootWorkspace.value?.workspace?.workspaceId ?? null) + " path=" + String(bootWorkspace.value?.workspace?.path ?? null) + " created=" + String(bootWorkspace.value?.created ?? null) + (bootWorkspace.ok === true ? "" : " error=" + JSON.stringify(bootWorkspace.error)))

  const chromePort = await freePort()
  const chromeProfile = join(SAND, "chromium-profile-m4")
  const chromeFd = openSync(join(RAW, "step4-chromium.log"), "a")
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

  await session.send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(join(EVID, "probe-hook.js"), "utf8") })
  await session.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false })
  await session.send("Page.navigate", { url: base + "/?token=" + encodeURIComponent(token) })
  await session.waitFor("document.querySelectorAll('button[aria-haspopup=\"dialog\"]').length > 0", { timeoutMs: 90000, label: "app hydration" })
  say("app hydrated")
  await sleep(3000)

  // ── 1. register the sandbox workspace through the HOST API, from the PAGE (host fully mounted) ──
  const pageCall = async (method, args) => session.evaluate(`(async () => {
    const response = await fetch("/api/${method}", {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ type: "client-request", rpcId: "mpd-m2-page-" + String(Date.now()), method: ${JSON.stringify(method)}, payload: { args: ${JSON.stringify(args)} } }),
    });
    const envelope = await response.json().catch(() => ({}));
    return { httpStatus: response.status, ok: envelope?.result?.ok ?? null, value: envelope?.result?.value ?? null, error: envelope?.result?.error ?? null };
  })()`)
  const pageWs = await pageCall("workspace/create", { request: { path: WS } })
  result.measurements.workspaceCreateFromPage = { args: { request: { path: WS } }, ...pageWs }
  say("WORKSPACE create (page): " + JSON.stringify(pageWs))
  let workspaceId = pageWs.value?.workspace?.workspaceId ?? null
  if (workspaceId === null) {
    const nodeWs = await rpc("workspace/create", { request: { path: WS } }, cookie)
    result.measurements.workspaceCreateFromNode = { status: nodeWs.status, ok: nodeWs.ok, value: nodeWs.value, error: nodeWs.error }
    say("WORKSPACE create (node): " + JSON.stringify({ ok: nodeWs.ok, error: nodeWs.error, value: nodeWs.value }))
    workspaceId = nodeWs.value?.workspace?.workspaceId ?? null
  }
  result.measurements.workspaceId = workspaceId
  say("WORKSPACE id: " + String(workspaceId))

  // ── 2. the APP's own navigation: watch `current` until the app opens a session ───────────────
  const currentTimeline = []
  const readCurrent = `(() => {
    const byDeps = window.__MPD_SCOPED_BY_DEPS__ ?? {};
    const ctx = byDeps[${JSON.stringify(CARD_DEPS_KEY)}] ?? window.__MPD_CTX__;
    let snapshotCurrent = "NO-CTX"; let currentTypeof = "NO-CTX"; let ids = []; let phase = null;
    try {
      const sessions = ctx === undefined ? undefined : ctx.get("sessions");
      const snapshot = sessions?.list?.getSnapshot?.();
      if (snapshot !== undefined) { snapshotCurrent = snapshot.current ?? null; currentTypeof = typeof snapshot.current; ids = Array.isArray(snapshot.ids) ? snapshot.ids : []; phase = snapshot.phase ?? null; }
    } catch (error) { snapshotCurrent = "THREW: " + String(error?.message ?? error); }
    return { at: Date.now(), current: snapshotCurrent, currentTypeof, idCount: ids.length, phase, body: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160) };
  })()`
  for (let tick = 0; tick < 24; tick += 1) {
    const read = await session.evaluate(readCurrent)
    currentTimeline.push(read)
    if (tick % 3 === 0) say("tick " + String(tick) + " current=" + JSON.stringify(read.current) + " typeof=" + String(read.currentTypeof) + " ids=" + String(read.idCount))
    if (typeof read.current === "string" && read.current !== "") break
    await sleep(2000)
  }
  result.measurements.currentTimeline = currentTimeline
  const liveCurrent = currentTimeline.find((entry) => typeof entry.current === "string" && entry.current !== "")?.current ?? null
  result.measurements.liveCurrentSessionId = liveCurrent
  say("LIVE current session id: " + JSON.stringify(liveCurrent) + " (typeof measured: " + JSON.stringify(currentTimeline.map((entry) => entry.currentTypeof).slice(-3)) + ")")
  await session.screenshot(join(RAW, "step4-app-with-session.png"))

  // ── 3. the card's OWN scoped ctx: directoryFor(current) with the live id ─────────────────────
  const directoryProbe = await session.evaluate(`(() => {
    const byDeps = window.__MPD_SCOPED_BY_DEPS__ ?? {};
    const ctx = byDeps[${JSON.stringify(CARD_DEPS_KEY)}];
    if (ctx === undefined) return { error: "the card's scoped ctx was never captured", keys: Object.keys(byDeps) };
    const sessions = ctx.get("sessions");
    const directories = ctx.get("modelDirectories");
    const current = sessions?.list?.getSnapshot?.()?.current ?? null;
    const out = { current, currentTypeof: typeof current, hasDirectoryFor: typeof directories?.directoryFor === "function" };
    try {
      const found = directories.directoryFor(current);
      const snapshot = found?.store?.getSnapshot?.();
      const groups = Array.isArray(snapshot?.groups) ? snapshot.groups : (Array.isArray(snapshot?.value?.groups) ? snapshot.value.groups : []);
      out.store = { status: snapshot?.status ?? null, groups: groups.map((group) => ({ id: group?.id ?? null, models: Array.isArray(group?.models) ? group.models.length : null })) };
      out.providers = groups.length;
      out.models = groups.reduce((total, group) => total + (Array.isArray(group?.models) ? group.models.length : 0), 0);
    } catch (error) { out.directoryForThrew = String(error?.message ?? error); }
    return out;
  })()`)
  result.measurements.directoryProbeOnCardCtx = directoryProbe
  say("DIRECTORY probe on the card's ctx: " + JSON.stringify(directoryProbe))

  // ── 3b. the FALLBACK path: a LISTED session that is not current (`eligible(id)` accepts any
  //        listed id, so the resolver mints its scope on demand) ─────────────────────────────────
  const listedProbe = await session.evaluate(`(() => {
    const byDeps = window.__MPD_SCOPED_BY_DEPS__ ?? {};
    const ctx = byDeps[${JSON.stringify(CARD_DEPS_KEY)}];
    if (ctx === undefined) return { error: "the card's scoped ctx was never captured" };
    const sessions = ctx.get("sessions");
    const directories = ctx.get("modelDirectories");
    const snapshot = sessions?.list?.getSnapshot?.() ?? {};
    const ids = Array.isArray(snapshot.ids) ? snapshot.ids : [];
    const current = snapshot.current ?? null;
    const out = { current, idCount: ids.length, candidates: [] };
    for (const id of ids) {
      if (id === current) continue;
      let scope; let binding;
      try { scope = sessions.scope(id); binding = sessions.binding(id); } catch (error) { out.candidates.push({ id, scopeThrew: String(error?.message ?? error) }); continue; }
      const entry = { id, scopeResolved: scope !== undefined, bindingResolved: binding !== undefined, blank: snapshot.byId?.[id]?.blank ?? null };
      if (entry.scopeResolved && entry.bindingResolved) {
        try {
          const found = directories.directoryFor(id);
          const storeSnapshot = found?.store?.getSnapshot?.();
          const groups = Array.isArray(storeSnapshot?.groups) ? storeSnapshot.groups : [];
          entry.store = { status: storeSnapshot?.status ?? null, groups: groups.map((group) => ({ id: group?.id ?? null, models: Array.isArray(group?.models) ? group.models.length : null })) };
          entry.providers = groups.length;
          entry.models = groups.reduce((total, group) => total + (Array.isArray(group?.models) ? group.models.length : 0), 0);
        } catch (error) { entry.directoryForThrew = String(error?.message ?? error); }
      }
      out.candidates.push(entry);
      if (out.candidates.length >= 4) break;
    }
    return out;
  })()`)
  result.measurements.directoryProbeOnListedId = listedProbe
  say("DIRECTORY probe on a LISTED id: " + JSON.stringify(listedProbe))

  // ── 4. the CARD itself, with the app already on a session ────────────────────────────────────
  const open = await session.evaluate(OPEN_SETTINGS)
  await session.waitFor("document.querySelector('[role=\"dialog\"]') !== null", { timeoutMs: 20000, label: "the settings dialog" })
  await sleep(1200)
  const nav = await session.evaluate(CLICK_MPD_NAV)
  await session.waitFor("document.querySelector('[data-mpd-catalog-state]') !== null", { timeoutMs: 25000, label: "the mpd catalog status paragraph" })
  const samples = []
  for (let tick = 0; tick < 20; tick += 1) {
    await sleep(1000)
    const read = await session.evaluate(CARD_READ)
    const line = read.found === true ? read.statusText : "(no card)"
    if (samples.length === 0 || samples[samples.length - 1].statusText !== line) samples.push({ tick, statusText: line, attrs: read.catalogAttributes ?? null })
    if (String(line).startsWith("live catalog")) break
  }
  const card = await session.evaluate(CARD_READ)
  const allSelects = await session.evaluate(ALL_SELECTS_READ)
  result.measurements.cardOpen = { open, nav }
  result.measurements.cardSamples = samples
  result.measurements.card = card
  result.measurements.slotProviderSelects = allSelects.filter((select) => select.key !== null && /^teamModels\.slot[123]\.provider$/.test(select.key))
  say("CARD status: " + JSON.stringify(card.found === true ? card.statusText : card))
  say("CARD attrs: " + JSON.stringify(card.catalogAttributes ?? null))
  say("SLOT providers: " + JSON.stringify(result.measurements.slotProviderSelects.map((s) => ({ key: s.key, values: s.options.map((o) => o.value) }))))
  await session.screenshot(join(RAW, "step4-card-open.png"))

  const browserCatalog = await session.evaluate(`(async () => {
    const response = await fetch("/api/session/modelCatalog", {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ type: "client-request", rpcId: "mpd-m2-catalog", method: "session/modelCatalog", payload: { args: {} } }),
    });
    const envelope = await response.json();
    const value = envelope?.result?.value ?? envelope?.result ?? null;
    const groups = Array.isArray(value?.groups) ? value.groups : [];
    return { status: response.status, providers: groups.length, models: groups.reduce((total, group) => total + (Array.isArray(group.models) ? group.models.length : 0), 0), providerIds: groups.map((group) => group.id) };
  })()`)
  result.measurements.browserCatalog = browserCatalog
  say("BROWSER catalog: " + JSON.stringify(browserCatalog))

  result.measurements.scopedKeys = await session.evaluate(`Object.keys(window.__MPD_SCOPED_BY_DEPS__ ?? {})`)
  say("scoped ctx keys captured: " + JSON.stringify(result.measurements.scopedKeys))

  const mpdConsole = consoleEvents.filter((event) => /\[mpd\]/i.test(event.text))
  result.console = { total: consoleEvents.length, mpdPrefixed: mpdConsole }
  say("CONSOLE: total=" + String(consoleEvents.length) + " mpd=" + String(mpdConsole.length))
} catch (error) {
  result.error = String(error?.stack ?? error?.message ?? error)
  say("FAILED: " + result.error)
} finally {
  writeFileSync(join(RAW, "step4-result.json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(RAW, "step4-console.json"), JSON.stringify(consoleEvents, null, 2) + "\n")
  try { if (session !== null) await session.send("Browser.close") } catch { /* best effort */ }
  try { chrome?.kill("SIGKILL") } catch { /* best effort */ }
  try { host.kill("SIGKILL") } catch { /* best effort */ }
  await sleep(500)
  say("done error=" + String(result.error === null ? "none" : "set"))
  process.exit(result.error === null ? 0 : 1)
}
