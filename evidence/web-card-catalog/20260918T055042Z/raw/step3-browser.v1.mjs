#!/usr/bin/env bun
// web-card-catalog lane — STEP 3: a REAL browser against the REAL (sandboxed) web host.
//
// Boots the sandbox host, then drives Chrome-for-Testing over CDP (the npm `playwright` package is
// NOT resolvable in this repo) to reproduce the reported defect and measure it:
//   B  the provider <select> options, the catalog status line and the data-mpd-catalog-* attributes,
//      plus HOW the section was reached;
//   C  the browser-side catalog: the app's own `session/modelCatalog` RPC and the client's own
//      `modelDirectories` service;
//   D  every console error/warning emitted while the section renders;
//   E  the instrumentation verdict: did `ctx.inject(["modelDirectories","sessions"], cb)` ever fire,
//      and does a later catalog update reach the card's render.
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
const LOG = join(EVID, "output.log")
const say = (line) => { const text = "[browser] " + line; console.log(text); try { appendFileSync(LOG, text + "\n") } catch { /* best effort */ } }
mkdirSync(RAW, { recursive: true })

const result = {
  step: "browser",
  chromeBinary: CHROME,
  chromeVersion: null,
  playwrightResolvableInRepo: false,
  roots: { DSH_HOME, HOME: USER_HOME, workspace: WS },
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
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// ── boot the sandbox host ─────────────────────────────────────────────────────────────────────
const hostPort = await freePort()
const bootLog = join(RAW, "host-boot.log")
rmSync(bootLog, { force: true })
const bootFd = openSync(bootLog, "a")
const host = spawn("dsh", ["--profile", "web", "--port", String(hostPort), "--no-open"], {
  env: { ...process.env, DSH_HOME, HOME: USER_HOME },
  cwd: WS,
  stdio: ["ignore", bootFd, bootFd],
})
result.hostPid = host.pid
result.hostPort = hostPort
say("host boot pid=" + String(host.pid) + " port=" + String(hostPort))

const base = "http://127.0.0.1:" + String(hostPort)
const readBootLog = () => { try { return readFileSync(bootLog, "utf8") } catch { return "" } }
const rpc = async (method, args, cookie) => {
  const response = await fetch(base + "/api/" + method, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
    body: JSON.stringify({ type: "client-request", rpcId: "catalog-lane-" + method.replace("/", "-") + "-" + String(Date.now()), method, payload: { args } }),
    signal: AbortSignal.timeout(60000),
  }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
  const envelope = await response.json().catch(() => ({}))
  return { status: response.status, result: envelope?.result ?? null, error: envelope?.error ?? null, transport: envelope?.transport ?? null }
}

let chrome = null
let session = null
try {
  let cookie = ""
  let token = ""
  {
    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
      await sleep(1200)
      const log = readBootLog()
      const match = /token=([A-Za-z0-9_-]+)/.exec(log)
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
  result.launch = { tokenUrl: (base + "/?token=" + token).replace(/token=[A-Za-z0-9_-]+/, "token=<redacted>"), tokenLength: token.length, cookieObtained: cookie !== "" }

  // A live session must exist and be the CLIENT's current one: the card binds `directoryFor` on
  // `sessions.list.getSnapshot().current`. The browser app opens the newest session itself.
  const create = await rpc("session/create", { request: { cwd: WS, agentPreset: "mpd" } }, cookie)
  const sessionId = create.result?.sessionId ?? create.result?.value?.sessionId ?? create.result?.id ?? null
  result.preCreatedSession = { status: create.status, sessionId, error: create.error }
  say("pre-created session " + String(sessionId) + " (status " + String(create.status) + ")")

  // ── launch Chrome-for-Testing at about:blank so the hook lands BEFORE any page script ──────
  const chromePort = await freePort()
  const chromeProfile = join(SAND, "chromium-profile")
  rmSync(chromeProfile, { recursive: true, force: true })
  const chromeLog = join(RAW, "chromium.log")
  const chromeFd = openSync(chromeLog, "a")
  chrome = spawn(CHROME, [
    "--headless",
    "--remote-debugging-port=" + String(chromePort),
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--window-size=1680,1050",
    "--user-data-dir=" + chromeProfile,
    "about:blank",
  ], { stdio: ["ignore", chromeFd, chromeFd] })
  result.chromePid = chrome.pid
  result.chromePort = chromePort
  say("chromium pid=" + String(chrome.pid) + " debugging port=" + String(chromePort) + " binary=" + CHROME)
  try {
    const version = await (await fetch("http://127.0.0.1:" + String(chromePort) + "/json/version", { signal: AbortSignal.timeout(4000) })).json()
    result.chromeVersion = version.Browser ?? null
    result.chromeUserAgent = version["User-Agent"] ?? null
  } catch { /* reported as null */ }

  const attached = await attachToPage(chromePort, { timeoutMs: 30000, log: say })
  session = attached.session
  await session.send("Page.enable")
  await session.send("Runtime.enable")
  await session.send("Log.enable")
  await session.send("Network.enable")

  // ── console capture (MEASUREMENT D) ────────────────────────────────────────────────────────
  const consoleEvents = []
  session.on("Runtime.consoleAPICalled", (params) => {
    consoleEvents.push({
      at: Date.now(), domain: "console." + String(params.type),
      text: (params.args ?? []).map((arg) => arg.value !== undefined ? (typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value)) : (arg.description ?? arg.unserializableValue ?? String(arg.type))).join(" "),
      url: params.stackTrace?.callFrames?.[0]?.url ?? null,
      line: params.stackTrace?.callFrames?.[0]?.lineNumber ?? null,
    })
    say("console." + String(params.type) + ": " + consoleEvents[consoleEvents.length - 1].text.slice(0, 400))
  })
  session.on("Runtime.exceptionThrown", (params) => {
    const details = params.exceptionDetails ?? {}
    consoleEvents.push({ at: Date.now(), domain: "exception", text: String(details.exception?.description ?? details.text ?? "unknown"), url: details.url ?? null, line: details.lineNumber ?? null })
    say("EXCEPTION: " + String(details.exception?.description ?? details.text ?? "").slice(0, 400))
  })
  session.on("Log.entryAdded", (params) => {
    const entry = params.entry ?? {}
    if (entry.level === "verbose") return
    consoleEvents.push({ at: Date.now(), domain: "log." + String(entry.level), text: String(entry.text ?? ""), url: entry.url ?? null, line: entry.lineNumber ?? null })
    say("log." + String(entry.level) + ": " + String(entry.text ?? "").slice(0, 400))
  })

  // ── the pre-document probe (MEASUREMENT E) ────────────────────────────────────────────────
  const hookSource = readFileSync(join(EVID, "probe-hook.js"), "utf8")
  const hookInstall = await session.send("Page.addScriptToEvaluateOnNewDocument", { source: hookSource })
  result.probeHook = { installed: true, identifier: hookInstall.identifier ?? null, bytes: Buffer.byteLength(hookSource) }

  await session.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false })

  const tokenUrl = base + "/?token=" + encodeURIComponent(token)
  await session.send("Page.navigate", { url: tokenUrl })
  say("navigated to the token URL")

  const t0 = Date.now()
  await session.waitFor("document.querySelectorAll('button[aria-haspopup=\"dialog\"]').length > 0", { timeoutMs: 90000, label: "app hydration (settings trigger present)" })
  say("app hydrated in " + String(Date.now() - t0) + " ms; probe=" + JSON.stringify(await session.evaluate("({hook: !!window.__MPD_PROBE__, loader: !!window.__ModuleLoader__, loads: (window.__MPD_PROBE__?.loaderLoadCalls ?? []).length})")))
  // The session list may still be arriving; give the app a moment and re-sample later.
  await sleep(4000)
  await session.evaluate("window.__MPD_SAMPLE_CARD__ && window.__MPD_SAMPLE_CARD__('post-hydrate')")

  // ── MEASUREMENT B: reach the MPD settings section ─────────────────────────────────────────
  const drive = { steps: [] }
  const triggerLabels = await session.evaluate(`[...document.querySelectorAll('button[aria-haspopup="dialog"]')].map((el, index) => ({ index, ariaLabel: el.getAttribute("aria-label"), text: (el.textContent ?? "").trim().slice(0, 60), rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })() }))`)
  drive.settingsTriggers = triggerLabels
  say("settings triggers found: " + JSON.stringify(triggerLabels))
  let opened = -1
  for (const candidate of triggerLabels) {
    const click = await session.clickSelector('button[aria-haspopup="dialog"]', { index: candidate.index })
    await sleep(900)
    const dialogOpen = await session.evaluate("document.querySelector('[role=\"dialog\"]') !== null")
    drive.steps.push({ action: "click settings trigger", index: candidate.index, ariaLabel: candidate.ariaLabel, click, dialogOpen })
    if (dialogOpen === true) { opened = candidate.index; break }
  }
  if (opened === -1) throw new Error("the settings dialog could not be opened with any button[aria-haspopup=dialog]")
  await session.waitFor("document.querySelector('[role=\"dialog\"]') !== null", { timeoutMs: 15000, label: "settings dialog" })

  // The settings panel is NOT the only [role="dialog"] in the document (a display-mode prompt is
  // also present and comes FIRST in DOM order), so the section nav is located by its own buttons:
  // the host shell renders every registered `settings.section` as a <button> in the nav list, and
  // this bundle's section registers the label `MPD`.
  const inventory = await session.evaluate(`(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].map((el, index) => {
      const rect = el.getBoundingClientRect();
      return { index, visible: rect.width > 0 && rect.height > 0, ariaLabelledby: el.getAttribute("aria-labelledby"), text: (el.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 180) };
    });
    const buttons = [...document.querySelectorAll("button")].map((el, index) => {
      const rect = el.getBoundingClientRect();
      return { index, text: (el.textContent ?? "").trim().slice(0, 40), visible: rect.width > 0 && rect.height > 0, inDialog: el.closest('[role="dialog"]') !== null, ariaCurrent: el.getAttribute("aria-current") };
    });
    const visible = buttons.filter((row) => row.visible && row.text !== "");
    return {
      dialogs,
      buttonsInDialogs: visible.filter((row) => row.inDialog),
      mpdButtons: visible.filter((row) => row.text === "MPD"),
      navLikeRows: visible.filter((row) => row.inDialog && row.text.length > 1 && row.text.length < 24),
    };
  })()`)
  drive.dialogInventory = inventory
  drive.navRows = inventory.navLikeRows
  say("dialogs in document: " + JSON.stringify(inventory.dialogs.map((dialog) => ({ index: dialog.index, visible: dialog.visible, text: dialog.text.slice(0, 60) }))))
  say("settings nav rows: " + JSON.stringify(inventory.navLikeRows.map((row) => row.text)))
  say("MPD nav buttons: " + JSON.stringify(inventory.mpdButtons))

  const mpd = inventory.mpdButtons[0]
  if (mpd === undefined) {
    result.measurementB = { reachedHow: drive, card: { found: false, reason: "no visible MPD nav button in any dialog" } }
    const probeNow = await session.evaluate("window.__MPD_PROBE__ ? JSON.parse(JSON.stringify({...window.__MPD_PROBE__, readCard: undefined})) : null")
    writeFileSync(join(RAW, "probe-no-mpd-row.json"), JSON.stringify(probeNow, null, 2) + "\n")
    if (typeof (await session.evaluate("(() => { const el = document.querySelector('[role=\"dialog\"]'); return el === null ? null : el.outerHTML; })()")) === "string") writeFileSync(join(RAW, "settings-dialog.html"), await session.evaluate("document.querySelector('[role=\"dialog\"]').outerHTML"))
    await session.screenshot(join(RAW, "no-mpd-nav-row.png"))
    throw new Error("no visible MPD nav button: the mpd settings section did not register. mpd loader ids: " + JSON.stringify((probeNow?.loaderLoadCalls ?? []).filter((entry) => String(entry.id).includes("mpd"))))
  }
  const mpdClick = await session.clickSelector("button", { index: mpd.index })
  drive.steps.push({ action: "click MPD nav row", index: mpd.index, click: mpdClick })
  say("clicked the MPD nav row (button index " + String(mpd.index) + ")")

  let cardAppeared = true
  try {
    await session.waitFor("document.querySelector('[data-mpd-catalog-state]') !== null", { timeoutMs: 15000, label: "the mpd catalog status paragraph" })
  } catch (error) {
    cardAppeared = false
    drive.cardAppearedError = String(error.message)
  }
  // Let the async acquisition settle; sample the card's state transitions throughout.
  for (let tick = 0; tick < 8; tick += 1) {
    await sleep(1000)
    await session.evaluate("window.__MPD_SAMPLE_CARD__ && window.__MPD_SAMPLE_CARD__('settle')")
  }

  const card = await session.evaluate(`(() => {
    const status = document.querySelector('[data-mpd-catalog-state]');
    const section = status === null ? null : (status.closest('[role="dialog"]') ?? document);
    const selects = [...(section ?? document).querySelectorAll('select')].map((el, index) => ({
      index,
      name: el.getAttribute('name'), id: el.getAttribute('id'), ariaLabel: el.getAttribute('aria-label'), className: String(el.className).slice(0, 40),
      value: el.value,
      optionCount: el.options.length,
      options: [...el.options].map((option) => ({ value: option.value, label: option.textContent, selected: option.selected })),
      providerValues: [...new Set([...el.options].map((option) => option.value.split('/')[0]))],
    }));
    // The slot name each select belongs to: the label cell that precedes it in the same row.
    const rows = [...(section ?? document).querySelectorAll('select')].map((el) => {
      const labelled = el.getAttribute('aria-label') ?? el.getAttribute('name') ?? '';
      const row = el.closest('div');
      return { labelled, rowText: (row?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 220) };
    });
    const attrs = {};
    if (status !== null) for (const attribute of status.attributes) attrs[attribute.name] = attribute.value;
    return {
      found: status !== null,
      statusTag: status === null ? null : status.tagName,
      statusText: status === null ? null : (status.textContent ?? '').trim(),
      statusInnerHTML: status === null ? null : status.innerHTML,
      catalogAttributes: attrs,
      selectCount: selects.length,
      selects, rows,
      dialogText: (status?.closest('[role="dialog"]')?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 1500),
      headingTexts: [...(status?.closest('[role="dialog"]') ?? document).querySelectorAll('h1,h2,h3')].map((el) => el.textContent.trim()).slice(0, 20),
    };
  })()`)
  drive.cardAppeared = cardAppeared
  result.measurementB = { reachedHow: drive, card }
  say("card: found=" + String(card.found) + " text=" + JSON.stringify(card.statusText) + " attrs=" + JSON.stringify(card.catalogAttributes) + " selects=" + String(card.selectCount))
  for (const select of card.selects ?? []) say("  select[" + String(select.index) + "] " + String(select.name ?? select.ariaLabel) + " options=" + String(select.optionCount) + " providers=" + JSON.stringify(select.providerValues))
  const screenshotDialog = await session.screenshot(join(RAW, "settings-mpd-section.png"))
  result.screenshots = { settingsMpdSection: screenshotDialog }
  const sectionHtml = await session.evaluate("(() => { const node = document.querySelector('[data-mpd-catalog-state]'); const el = node === null ? null : node.closest('[role=\"dialog\"]'); return el === null ? null : el.outerHTML; })()")
  if (typeof sectionHtml === "string") writeFileSync(join(RAW, "settings-dialog.html"), sectionHtml)

  // ── MEASUREMENT C: the browser-side catalog ────────────────────────────────────────────────
  const browserCatalog = await session.evaluate(`(async () => {
    const out = {};
    try {
      const response = await fetch("/api/session/modelCatalog", {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ type: "client-request", rpcId: "catalog-lane-inpage-" + String(Date.now()), method: "session/modelCatalog", payload: { args: {} } }),
      });
      const envelope = await response.json();
      const value = envelope?.result?.value ?? envelope?.result ?? null;
      const groups = Array.isArray(value?.groups) ? value.groups : [];
      out.rpc = {
        status: response.status,
        ok: envelope?.result?.ok ?? null,
        routableProviders: value?.routableProviders ?? null,
        failures: value?.failures ?? null,
        providerCount: groups.length,
        modelCount: groups.reduce((total, group) => total + (Array.isArray(group?.models) ? group.models.length : 0), 0),
        groups: groups.map((group) => ({ id: group?.id ?? null, name: group?.name ?? null, models: Array.isArray(group?.models) ? group.models.length : 0, modelIds: (group?.models ?? []).map((model) => model?.id ?? null) })),
      };
    } catch (error) { out.rpcError = String(error?.message ?? error); }
    // The CLIENT's own service, reached the way the card is SUPPOSED to reach it.
    try {
      const ctx = window.__MPD_CTX__;
      if (ctx === undefined || ctx === null) { out.service = "no ctx captured (the probe hook saw no apply/mount)"; return out; }
      const service = await new Promise((resolvePromise) => {
        const timer = setTimeout(() => resolvePromise({ timedOut: true }), 12000);
        try {
          ctx.inject(["modelDirectories", "sessions"], (scoped) => {
            clearTimeout(timer);
            try {
              const directories = scoped.get("modelDirectories");
              const sessions = scoped.get("sessions");
              const snapshot = sessions?.list?.getSnapshot?.();
              const sessionId = snapshot?.current?.sessionId ?? snapshot?.current?.id ?? null;
              const directory = sessionId === null ? undefined : directories.directoryFor(sessionId);
              const storeSnapshot = directory?.store?.getSnapshot?.();
              const groups = storeSnapshot?.value?.groups ?? storeSnapshot?.groups ?? [];
              resolvePromise({
                fired: true, sessionId,
                hasDirectory: directory !== undefined && directory !== null,
                directoryStoreStatus: storeSnapshot?.status ?? null,
                providerCount: Array.isArray(groups) ? groups.length : null,
                modelCount: Array.isArray(groups) ? groups.reduce((total, group) => total + (Array.isArray(group?.models) ? group.models.length : 0), 0) : null,
                groups: Array.isArray(groups) ? groups.map((group) => ({ id: group?.id ?? null, models: (group?.models ?? []).map((model) => model?.id ?? null) })) : [],
              });
            } catch (error) { resolvePromise({ fired: true, error: String(error?.message ?? error) }); }
          });
        } catch (error) { clearTimeout(timer); resolvePromise({ injectThrew: String(error?.message ?? error) }); }
      });
      out.service = service;
    } catch (error) { out.serviceError = String(error?.message ?? error); }
    return out;
  })()`)
  result.measurementC = browserCatalog
  say("MEASUREMENT C: in-page RPC providers=" + String(browserCatalog.rpc?.providerCount) + " models=" + String(browserCatalog.rpc?.modelCount) + " groups=" + JSON.stringify((browserCatalog.rpc?.groups ?? []).map((group) => group.id + ":" + String(group.models))))
  say("MEASUREMENT C: client's own modelDirectories service -> " + JSON.stringify(browserCatalog.service ?? browserCatalog.serviceError ?? null).slice(0, 600))

  // ── MEASUREMENT D: console, verbatim ──────────────────────────────────────────────────────
  result.measurementD = {
    total: consoleEvents.length,
    errors: consoleEvents.filter((entry) => entry.domain === "console.error" || entry.domain === "exception" || entry.domain === "log.error"),
    warnings: consoleEvents.filter((entry) => entry.domain === "console.warning" || entry.domain === "console.warn" || entry.domain === "log.warning"),
    all: consoleEvents,
  }
  writeFileSync(join(RAW, "console.json"), JSON.stringify(consoleEvents, null, 2) + "\n")
  say("MEASUREMENT D: " + String(consoleEvents.length) + " console events, " + String(result.measurementD.errors.length) + " errors, " + String(result.measurementD.warnings.length) + " warnings")

  // ── MEASUREMENT E: the instrumentation verdict ────────────────────────────────────────────
  await session.evaluate("window.__MPD_SAMPLE_CARD__ && window.__MPD_SAMPLE_CARD__('pre-verdict')")
  const probe = await session.evaluate("(() => { const p = window.__MPD_PROBE__; if (!p) return { MISSING: true }; const { readCard, ...rest } = p; return JSON.parse(JSON.stringify(rest)); })()")
  writeFileSync(join(RAW, "probe.json"), JSON.stringify(probe, null, 2) + "\n")
  const mpdBundlesArrived = (probe.loaderLoadCalls ?? []).filter((entry) => String(entry.id).startsWith("@mpd-dsh/"))
  const cardInjectCalls = (probe.injectCalls ?? []).filter((entry) => Array.isArray(entry.dependencies) && entry.dependencies.includes("modelDirectories"))
  result.measurementE = {
    probeInstalled: probe.MISSING !== true,
    loaderLoadCallCount: (probe.loaderLoadCalls ?? []).length,
    mpdBundlesArrived,
    ctxCaptured: probe.ctxCaptured === true,
    injectWrapped: probe.injectWrapped === true,
    applyCalls: probe.applyCalls ?? [],
    mountCalls: probe.mountCalls ?? [],
    injectCallsForModelDirectories: cardInjectCalls,
    anyInjectCallbackFired: (probe.injectCalls ?? []).some((entry) => entry.callbackFired === true),
    cardRenderStates: probe.cardStates ?? [],
    directoryLoads: probe.directoryLoads ?? [],
    probeWarnings: (probe.warnings ?? []).map((entry) => entry.text),
    probeErrors: (probe.errors ?? []).map((entry) => entry.text),
    probeNotes: probe.notes ?? [],
  }
  say("MEASUREMENT E: mpd bundles arrived=" + JSON.stringify(mpdBundlesArrived.map((entry) => entry.id)) + " ctxCaptured=" + String(probe.ctxCaptured) + " injectWrapped=" + String(probe.injectWrapped))
  say("MEASUREMENT E: card inject calls=" + JSON.stringify(cardInjectCalls.map((entry) => ({ deps: entry.dependencies, fired: entry.callbackFired, scoped: entry.scoped }))) + " cardStates=" + JSON.stringify((probe.cardStates ?? []).map((state) => [state.state, state.providers, state.models, state.text, state.why])))
  for (const warning of result.measurementE.probeWarnings) say("PROBE WARN: " + warning.slice(0, 300))
  for (const error of result.measurementE.probeErrors) say("PROBE ERROR: " + error.slice(0, 300))

  result.ok = true
  result.error = null
} catch (error) {
  result.ok = false
  result.error = String(error?.stack ?? error?.message ?? error)
  say("FAILED: " + String(error?.message ?? error))
  try {
    if (session !== null) {
      result.failureDiagnostics = {
        url: await session.evaluate("location.href").catch(() => null),
        bodyText: await session.evaluate("document.body ? document.body.innerText.slice(0, 2000) : null").catch(() => null),
        probe: await session.evaluate("window.__MPD_PROBE__ ? JSON.parse(JSON.stringify({...window.__MPD_PROBE__, readCard: undefined})) : null").catch(() => null),
      }
      await session.screenshot(join(RAW, "failure.png"))
    }
  } catch { /* best effort */ }
} finally {
  try { session?.dispose() } catch { /* ignore */ }
  try { chrome?.kill("SIGTERM") } catch { /* ignore */ }
  try { host.kill("SIGTERM") } catch { /* ignore */ }
  await sleep(2000)
  try { chrome?.kill("SIGKILL") } catch { /* ignore */ }
  try { host.kill("SIGKILL") } catch { /* ignore */ }
  writeFileSync(join(RAW, "step3-browser.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(JSON.stringify({ ok: result.ok, error: result.error ?? null, B: result.measurementB?.card ? { statusText: result.measurementB.card.statusText, attrs: result.measurementB.card.catalogAttributes, selects: (result.measurementB.card.selects ?? []).map((select) => ({ name: select.name, providers: select.providerValues, options: select.optionCount })) } : null, C: result.measurementC ? { rpc: result.measurementC.rpc ? { providers: result.measurementC.rpc.providerCount, models: result.measurementC.rpc.modelCount } : null, service: result.measurementC.service } : null, D: result.measurementD ? { total: result.measurementD.total, errors: result.measurementD.errors.length, warnings: result.measurementD.warnings.length } : null, E: result.measurementE ? { mpd: (result.measurementE.mpdBundlesArrived ?? []).map((entry) => entry.id), ctxCaptured: result.measurementE.ctxCaptured, injectCalls: (result.measurementE.injectCallsForModelDirectories ?? []).map((entry) => ({ deps: entry.dependencies, fired: entry.callbackFired })), cardStates: result.measurementE.cardRenderStates } : null }, null, 2))
}
process.exit(result.ok === true ? 0 : 1)
