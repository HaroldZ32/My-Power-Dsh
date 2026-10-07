#!/usr/bin/env bun
// web-card-catalog lane — STEP 3: a REAL browser against the REAL (sandboxed) web host.
//
// Boots the sandbox host, then drives Chrome-for-Testing over CDP (the npm `playwright` package is
// NOT resolvable in this repo — verified) to reproduce the reported defect and measure it:
//   B  the provider <select> options, the catalog status line and the data-mpd-catalog-* attributes,
//      plus HOW the section was reached — BEFORE and AFTER a session becomes current;
//   C  the browser-side catalog: the app's own `session/modelCatalog` RPC and the client's own
//      `modelDirectories` service;
//   D  every console error/warning emitted while the section renders;
//   E  the instrumentation verdict: did `ctx.inject(["modelDirectories","sessions"], cb)` ever fire,
//      does the card RE-bind when a session becomes current, and does a later catalog update reach
//      the card's render.
import { appendFileSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
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
const redact = (text) => String(text).replace(/token=[A-Za-z0-9_-]+/g, "token=<redacted>")

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
  return { status: response.status, result: envelope?.result ?? null, error: envelope?.error ?? null }
}

// One selector for every clickable surface, so an index reported by `inventory()` and the index
// used to click are always positions in the SAME node list.
const CLICKABLE = 'button, [role="menuitem"], [role="option"], [role="button"], [role="row"], a[href], li'
const CLICKABLE_JS = CLICKABLE

const CARD_READ = `(() => {
  const status = document.querySelector('[data-mpd-catalog-state]');
  if (status === null) return { found: false };
  const attrs = {};
  for (const attribute of status.attributes) attrs[attribute.name] = attribute.value;
  const dialog = status.closest('[role="dialog"]') ?? document;
  const selects = [...dialog.querySelectorAll('select')].map((el, index) => ({
    index, name: el.getAttribute('name'), id: el.getAttribute('id'), ariaLabel: el.getAttribute('aria-label'),
    value: el.value, optionCount: el.options.length,
    options: [...el.options].map((option) => ({ value: option.value, label: option.textContent, selected: option.selected })),
    providerValues: [...new Set([...el.options].map((option) => option.value.split('/')[0]))],
  }));
  return {
    found: true, at: Date.now(), statusText: (status.textContent ?? '').trim(),
    catalogAttributes: attrs, selectCount: selects.length, selects,
    providerValuesBySelect: selects.map((select) => select.providerValues),
    headingTexts: [...dialog.querySelectorAll('h1,h2,h3')].map((el) => el.textContent.trim()).slice(0, 10),
  };
})()`

let chrome = null
let session = null
try {
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
  result.launch = { tokenUrl: redact(base + "/?token=" + token), tokenLength: token.length, cookieObtained: cookie !== "" }

  // ── launch Chrome-for-Testing at about:blank so the hook lands BEFORE any page script ──────
  const chromePort = await freePort()
  const chromeProfile = join(SAND, "chromium-profile")
  rmSync(chromeProfile, { recursive: true, force: true })
  const chromeFd = openSync(join(RAW, "chromium.log"), "a")
  chrome = spawn(CHROME, [
    "--headless", "--remote-debugging-port=" + String(chromePort), "--no-sandbox", "--disable-setuid-sandbox",
    "--disable-gpu", "--disable-dev-shm-usage", "--remote-allow-origins=*", "--no-first-run",
    "--no-default-browser-check", "--hide-scrollbars", "--window-size=1680,1050",
    "--user-data-dir=" + chromeProfile, "about:blank",
  ], { stdio: ["ignore", chromeFd, chromeFd] })
  result.chromePid = chrome.pid
  result.chromePort = chromePort
  say("chromium pid=" + String(chrome.pid) + " debugging port=" + String(chromePort))
  try {
    const version = await (await fetch("http://127.0.0.1:" + String(chromePort) + "/json/version", { signal: AbortSignal.timeout(4000) })).json()
    result.chromeVersion = version.Browser ?? null
    result.chromeUserAgent = version["User-Agent"] ?? null
  } catch { /* null */ }

  const attached = await attachToPage(chromePort, { timeoutMs: 30000, log: say })
  session = attached.session
  await session.send("Page.enable")
  await session.send("Runtime.enable")
  await session.send("Log.enable")

  // ── console capture (MEASUREMENT D) ────────────────────────────────────────────────────────
  const consoleEvents = []
  const pushConsole = (event) => { consoleEvents.push({ at: Date.now(), ...event }); say(event.domain + ": " + String(event.text).slice(0, 300)) }
  session.on("Runtime.consoleAPICalled", (params) => pushConsole({
    domain: "console." + String(params.type),
    text: (params.args ?? []).map((arg) => arg.value !== undefined ? (typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value)) : (arg.description ?? arg.unserializableValue ?? String(arg.type))).join(" "),
    url: params.stackTrace?.callFrames?.[0]?.url ?? null,
    line: params.stackTrace?.callFrames?.[0]?.lineNumber ?? null,
  }))
  session.on("Runtime.exceptionThrown", (params) => {
    const details = params.exceptionDetails ?? {}
    pushConsole({ domain: "exception", text: String(details.exception?.description ?? details.text ?? "unknown").split("\n")[0], url: details.url ?? null, line: details.lineNumber ?? null, fullText: String(details.exception?.description ?? details.text ?? "") })
  })
  session.on("Log.entryAdded", (params) => {
    const entry = params.entry ?? {}
    if (entry.level === "verbose") return
    pushConsole({ domain: "log." + String(entry.level), text: String(entry.text ?? ""), url: entry.url ?? null, line: entry.lineNumber ?? null })
  })

  // ── the pre-document probe (MEASUREMENT E) ────────────────────────────────────────────────
  const hookSource = readFileSync(join(EVID, "probe-hook.js"), "utf8")
  const hookInstall = await session.send("Page.addScriptToEvaluateOnNewDocument", { source: hookSource })
  result.probeHook = { installed: true, identifier: hookInstall.identifier ?? null, bytes: Buffer.byteLength(hookSource) }
  await session.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false })

  await session.send("Page.navigate", { url: base + "/?token=" + encodeURIComponent(token) })
  say("navigated to the token URL")
  const t0 = Date.now()
  await session.waitFor("document.querySelectorAll('button[aria-haspopup=\"dialog\"]').length > 0", { timeoutMs: 90000, label: "app hydration (settings trigger present)" })
  say("app hydrated in " + String(Date.now() - t0) + " ms")
  await sleep(3000)
  await session.evaluate("window.__MPD_SAMPLE_CARD__ && window.__MPD_SAMPLE_CARD__('post-hydrate')")

  // ── shared UI actions ─────────────────────────────────────────────────────────────────────
  const pressEscape = async () => {
    for (const type of ["keyDown", "keyUp"]) {
      await session.send("Input.dispatchKeyEvent", { type, windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27, key: "Escape", code: "Escape" })
    }
    await sleep(600)
  }
  const inventory = async () => session.evaluate(`(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].map((el, index) => {
      const rect = el.getBoundingClientRect();
      return { index, visible: rect.width > 0 && rect.height > 0, text: (el.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 120) };
    });
    const buttons = [...document.querySelectorAll(${JSON.stringify(CLICKABLE_JS)})].map((el, index) => {
      const rect = el.getBoundingClientRect();
      return { index, text: (el.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 60), visible: rect.width > 0 && rect.height > 0, inDialog: el.closest('[role="dialog"]') !== null, ariaCurrent: el.getAttribute("aria-current"), ariaLabel: el.getAttribute("aria-label"), tag: el.tagName };
    }).filter((row) => row.visible && row.text !== "");
    return { dialogs, inDialog: buttons.filter((row) => row.inDialog), all: buttons,
      mpd: buttons.filter((row) => row.text === "MPD"),
      newSession: buttons.filter((row) => /new session|new chat/i.test(row.text)),
      ariaCurrent: buttons.filter((row) => row.ariaCurrent !== null) };
  })()`)

  const openSettingsAndMpd = async (phaseLabel) => {
    const before = await inventory()
    const trigger = before.all.find((row) => row.ariaLabel === "Settings") ?? before.all.find((row) => /settings/i.test(row.text))
    if (trigger === undefined) throw new Error("no Settings trigger button found in the " + phaseLabel + " phase")
    await session.clickSelector(CLICKABLE, { index: trigger.index })
    await sleep(1000)
    let afterOpen = await inventory()
    let mpd = afterOpen.mpd[0]
    if (mpd === undefined) {
      await sleep(1500)
      afterOpen = await inventory()
      mpd = afterOpen.mpd[0]
      if (mpd === undefined) return { ok: false, reason: "no visible MPD nav button", inventory: afterOpen, trigger }
    }
    await session.clickSelector(CLICKABLE, { index: mpd.index })
    await sleep(1200)
    let card = null
    try {
      await session.waitFor("document.querySelector('[data-mpd-catalog-state]') !== null", { timeoutMs: 15000, label: "the mpd catalog status paragraph" })
      for (let tick = 0; tick < 6; tick += 1) {
        await sleep(700)
        await session.evaluate("window.__MPD_SAMPLE_CARD__ && window.__MPD_SAMPLE_CARD__('settle-" + phaseLabel + "')")
      }
      card = await session.evaluate(CARD_READ)
    } catch (error) {
      card = { found: false, error: String(error.message) }
    }
    return { ok: true, phase: phaseLabel, trigger, mpdIndex: mpd.index, dialogs: afterOpen.dialogs, card }
  }

  // ── MEASUREMENT B, PHASE 1: the card as the page first renders it ─────────────────────────
  const phase1 = await openSettingsAndMpd("phase1-initial")
  result.measurementB = { reachedHow: { settingsTrigger: phase1.trigger, mpdNavIndex: phase1.mpdIndex, dialogs: phase1.dialogs }, card: phase1.card }
  say("PHASE 1 card: " + JSON.stringify(phase1.card.found === true ? { text: phase1.card.statusText, attrs: phase1.card.catalogAttributes, providers: phase1.card.providerValuesBySelect } : phase1.card))
  await session.screenshot(join(RAW, "phase1-settings-mpd-section.png"))
  const sectionHtml = await session.evaluate("(() => { const node = document.querySelector('[data-mpd-catalog-state]'); const el = node === null ? null : node.closest('[role=\"dialog\"]'); return el === null ? null : el.outerHTML; })()")
  if (typeof sectionHtml === "string") writeFileSync(join(RAW, "phase1-settings-dialog.html"), sectionHtml)

  // ── the sessions service shape, read through the card's OWN scoped ctx ────────────────────
  const sessionsShape = async (label) => session.evaluate(`(() => {
    const scoped = window.__MPD_SCOPED__;
    if (scoped === undefined || scoped === null) return { label: ${JSON.stringify(label)}, scoped: "MISSING" };
    const sessions = scoped.get ? scoped.get("sessions") : scoped.sessions;
    const out = { label: ${JSON.stringify(label)}, serviceType: typeof sessions, hasList: typeof sessions?.list, listSubscribe: typeof sessions?.list?.subscribe, listGetSnapshot: typeof sessions?.list?.getSnapshot };
    try { out.serviceKeys = sessions === undefined || sessions === null ? null : Object.keys(sessions); } catch (error) { out.serviceKeysError = String(error.message); }
    try { out.listKeys = sessions?.list === undefined || sessions?.list === null ? null : Object.keys(sessions.list); } catch (error) { out.listKeysError = String(error.message); }
    try {
      const snapshot = sessions?.list?.getSnapshot?.();
      out.snapshotKeys = snapshot === undefined || snapshot === null ? null : Object.keys(snapshot);
      out.current = snapshot?.current ?? null;
      out.currentSessionId = snapshot?.current?.sessionId ?? snapshot?.current?.id ?? null;
      out.sessionCount = Array.isArray(snapshot?.sessions) ? snapshot.sessions.length : (Array.isArray(snapshot?.items) ? snapshot.items.length : null);
    } catch (error) { out.snapshotError = String(error.message); }
    return JSON.parse(JSON.stringify(out));
  })()`)
  result.sessionsShapeBefore = await sessionsShape("before-a-session-is-current")
  say("sessions service (before): " + JSON.stringify(result.sessionsShapeBefore).slice(0, 600))

  // ── PHASE 2: make a session CURRENT through the UI, then re-read the card ─────────────────
  // MEASURED (previous run): clicking "New Session" opens the composer with the notice
  // "Choose a workspace to start" — this sandbox has no workspace selected, so the app cannot
  // create a session at all and `sessions.list.getSnapshot().current` stays null. A session has to
  // be created through the UI for the card's binding to have anything to bind to.
  const clickByPattern = async (pattern, label) => {
    const inv = await inventory()
    const candidate = inv.all.find((row) => pattern.test(row.text) || pattern.test(row.ariaLabel ?? ""))
    if (candidate === undefined) return { clicked: false, label, pattern: String(pattern), candidateTexts: inv.all.map((row) => row.text).slice(0, 60) }
    const click = await session.clickSelector(CLICKABLE, { index: candidate.index })
    return { clicked: true, label, text: candidate.text, ariaLabel: candidate.ariaLabel, index: candidate.index, click }
  }
  await pressEscape()
  const phase2 = { attempts: [] }
  result.phase2 = phase2
  phase2.sidebarBefore = await session.evaluate("(() => { const text = document.body.innerText; return { noSessionsMentions: (text.match(/No sessions yet/gi) ?? []).length, excerpt: text.replace(/\\s+/g, ' ').slice(0, 300) }; })()")
  phase2.attempts.push({ step: "new-session", ...(await clickByPattern(/new session|new chat/i, "new-session")) })
  say("PHASE 2: New Session -> " + JSON.stringify(phase2.attempts[phase2.attempts.length - 1]).slice(0, 300))
  await sleep(2500)
  let currentAfter = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const shape = await sessionsShape("poll-" + String(attempt))
    phase2.sessionsShapeAfter = shape
    currentAfter = shape
    if (shape.currentSessionId !== null && shape.currentSessionId !== undefined) { phase2.attempts.push({ step: "session-current", attempt, sessionId: shape.currentSessionId }); break }
    const composerText = await session.evaluate("(() => { const text = document.body.innerText; return text.replace(/\\s+/g, ' ').slice(0, 200); })()")
    let step
    if (/choose a workspace/i.test(composerText)) step = await clickByPattern(/choose workspace/i, "choose-workspace")
    else step = await clickByPattern(/choose workspace|browse|open folder|add workspace|recent|workspaces?$/i, "workspace-picker")
    phase2.attempts.push({ attempt, composerText: composerText.slice(0, 140), ...step })
    say("PHASE 2 attempt " + String(attempt) + ": " + JSON.stringify(step).slice(0, 300))
    if (step.clicked !== true) break
    await sleep(2200)
    // Inside a picker the sandbox workspace is the entry to pick, by its full path or basename.
    const pick = await clickByPattern(new RegExp(SAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "|\\bworkspace\\b", "i"), "sandbox-workspace-entry")
    if (pick.clicked === true) { phase2.attempts.push({ ...pick, step: "pick-sandbox-workspace" }); say("PHASE 2: picked workspace entry " + JSON.stringify(pick.text)); await sleep(2500) }
    if (attempt < 4) await session.screenshot(join(RAW, "phase2-attempt-" + String(attempt) + ".png"))
  }
  // The UI could not create a session (native workspace picker). To measure the card's chain WITH a
  // session current, the condition is established by an EXPLICIT state injection through the app's
  // own sessions store — never presented as a UI drive.
  if (currentAfter === null || currentAfter.currentSessionId === null || currentAfter.currentSessionId === undefined) {
    const created = await rpc("session/create", { request: { cwd: WS, agentPreset: "mpd" } }, cookie)
    const createdId = created.result?.value?.sessionId ?? created.result?.sessionId ?? null
    const injected = await session.evaluate(`(() => {
      const scoped = window.__MPD_SCOPED__;
      const sessions = scoped.get("sessions");
      const before = sessions.list.getSnapshot();
      sessions.list.set(Object.assign({}, before, { current: { sessionId: ${JSON.stringify("__ID__")} } }));
      const after = sessions.list.getSnapshot();
      return { before: before.current ?? null, afterId: after.current?.sessionId ?? after.current?.id ?? null };
    })()`.replace("__ID__", String(createdId)))
    phase2.stateInjection = { reason: "the UI could not create a session (native workspace picker); this is an EXPLICIT state injection through the app's own sessions store, NOT a UI drive", hostSessionCreated: createdId, injected }
    say("PHASE 2 (state injection): " + JSON.stringify(phase2.stateInjection))
    await sleep(4000)
    currentAfter = await sessionsShape("after-state-injection")
    phase2.sessionsShapeAfter = currentAfter
    await session.evaluate("window.__MPD_SAMPLE_CARD__ && window.__MPD_SAMPLE_CARD__('after-state-injection')")
  }
  phase2.sidebarAfter = await session.evaluate("(() => { const text = document.body.innerText; return { noSessionsMentions: (text.match(/No sessions yet/gi) ?? []).length, excerpt: text.replace(/\\s+/g, ' ').slice(0, 400) }; })()")
  say("PHASE 2: sessions service (after) = " + JSON.stringify(phase2.sessionsShapeAfter).slice(0, 500))
  say("PHASE 2: sidebar after = " + JSON.stringify(phase2.sidebarAfter).slice(0, 300))
  await session.screenshot(join(RAW, "phase2-after-workspace-and-session.png"))
  await session.evaluate("window.__MPD_SAMPLE_CARD__ && window.__MPD_SAMPLE_CARD__('after-session-current')")

  // ── PHASE 3: re-open the MPD section with a session CURRENT ───────────────────────────────
  const phase3 = await openSettingsAndMpd("phase3-with-session")
  const card3 = phase3.card ?? { found: false, reason: phase3.reason ?? "phase 3 returned nothing" }
  result.measurementBAfterSession = { card: card3, dialogs: phase3.dialogs ?? null }
  say("PHASE 3 card: " + JSON.stringify(card3.found === true ? { text: card3.statusText, attrs: card3.catalogAttributes, providers: card3.providerValuesBySelect } : card3))
  await session.screenshot(join(RAW, "phase3-settings-mpd-section-with-session.png"))
  const sectionHtml3 = await session.evaluate("(() => { const node = document.querySelector('[data-mpd-catalog-state]'); const el = node === null ? null : node.closest('[role=\"dialog\"]'); return el === null ? null : el.outerHTML; })()")
  if (typeof sectionHtml3 === "string") writeFileSync(join(RAW, "phase3-settings-dialog.html"), sectionHtml3)
  result.sessionsShapeAfterPhase3 = await sessionsShape("after-phase3")

  // ── MEASUREMENT C: the browser-side catalog ───────────────────────────────────────────────
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
      out.rpc = { status: response.status, ok: envelope?.result?.ok ?? null, routableProviders: value?.routableProviders ?? null,
        providerCount: groups.length,
        modelCount: groups.reduce((total, group) => total + (Array.isArray(group?.models) ? group.models.length : 0), 0),
        groups: groups.map((group) => ({ id: group?.id ?? null, name: group?.name ?? null, models: Array.isArray(group?.models) ? group.models.length : 0, modelIds: (group?.models ?? []).map((model) => model?.id ?? null) })) };
    } catch (error) { out.rpcError = String(error?.message ?? error); }
    try {
      const ctx = window.__MPD_CTX__;
      if (ctx === undefined || ctx === null) { out.service = "no ctx captured (the probe hook saw no apply/mount)"; return out; }
      out.service = await new Promise((resolvePromise) => {
        const timer = setTimeout(() => resolvePromise({ timedOut: true }), 15000);
        try {
          ctx.inject(["modelDirectories", "sessions"], (scoped) => {
            clearTimeout(timer);
            try {
              const directories = scoped.get("modelDirectories");
              const sessions = scoped.get("sessions");
              const snapshot = sessions?.list?.getSnapshot?.();
              const sessionId = snapshot?.current?.sessionId ?? snapshot?.current?.id ?? null;
              const directory = sessionId === null || sessionId === undefined ? undefined : directories.directoryFor(sessionId);
              const storeSnapshot = directory?.store?.getSnapshot?.();
              const groups = storeSnapshot?.value?.groups ?? storeSnapshot?.groups ?? [];
              resolvePromise({ fired: true, sessionId, hasDirectory: directory !== undefined && directory !== null,
                directoryStoreStatus: storeSnapshot?.status ?? null,
                providerCount: Array.isArray(groups) ? groups.length : null,
                modelCount: Array.isArray(groups) ? groups.reduce((total, group) => total + (Array.isArray(group?.models) ? group.models.length : 0), 0) : null,
                groups: Array.isArray(groups) ? groups.map((group) => ({ id: group?.id ?? null, models: (group?.models ?? []).map((model) => model?.id ?? null) })) : [] });
            } catch (error) { resolvePromise({ fired: true, error: String(error?.message ?? error) }); }
          });
        } catch (error) { clearTimeout(timer); resolvePromise({ injectThrew: String(error?.message ?? error) }); }
      });
    } catch (error) { out.serviceError = String(error?.message ?? error); }
    return out;
  })()`)
  result.measurementC = browserCatalog
  say("MEASUREMENT C: in-page RPC providers=" + String(browserCatalog.rpc?.providerCount) + " models=" + String(browserCatalog.rpc?.modelCount) + " " + JSON.stringify((browserCatalog.rpc?.groups ?? []).map((group) => group.id + ":" + String(group.models))))
  say("MEASUREMENT C: client's own modelDirectories service -> " + JSON.stringify(browserCatalog.service ?? browserCatalog.serviceError ?? null).slice(0, 700))

  // ── MEASUREMENT D ─────────────────────────────────────────────────────────────────────────
  result.measurementD = {
    total: consoleEvents.length,
    errors: consoleEvents.filter((entry) => entry.domain === "console.error" || entry.domain === "exception" || entry.domain === "log.error"),
    warnings: consoleEvents.filter((entry) => entry.domain === "console.warning" || entry.domain === "console.warn" || entry.domain === "log.warning"),
    all: consoleEvents,
  }
  writeFileSync(join(RAW, "console.json"), JSON.stringify(consoleEvents, null, 2) + "\n")
  say("MEASUREMENT D: " + String(consoleEvents.length) + " events, " + String(result.measurementD.errors.length) + " errors, " + String(result.measurementD.warnings.length) + " warnings")

  // ── MEASUREMENT E ─────────────────────────────────────────────────────────────────────────
  await session.evaluate("window.__MPD_SAMPLE_CARD__ && window.__MPD_SAMPLE_CARD__('pre-verdict')")
  const probe = await session.evaluate("(() => { const p = window.__MPD_PROBE__; if (!p) return { MISSING: true }; const { readCard, ...rest } = p; return JSON.parse(JSON.stringify(rest)); })()")
  writeFileSync(join(RAW, "probe.json"), JSON.stringify(probe, null, 2) + "\n")
  const cardInjectCalls = (probe.injectCalls ?? []).filter((entry) => Array.isArray(entry.dependencies) && entry.dependencies.includes("modelDirectories") && entry.dependencies.includes("sessions"))
  result.measurementE = {
    probeInstalled: probe.MISSING !== true,
    loaderLoadCallCount: (probe.loaderLoadCalls ?? []).length,
    mpdBundlesArrived: (probe.loaderLoadCalls ?? []).filter((entry) => String(entry.id).startsWith("@mpd-dsh/")),
    ctxCaptured: probe.ctxCaptured === true,
    injectWrapped: probe.injectWrapped === true,
    observerInstalled: probe.observerInstalled === true,
    applyCalls: probe.applyCalls ?? [],
    mountCalls: probe.mountCalls ?? [],
    cardInjectCalls: cardInjectCalls.map((entry) => ({ at: entry.at, deps: entry.dependencies, callbackFired: entry.callbackFired, firedAt: entry.firedAt ?? null, scoped: entry.scoped ?? null })),
    allInjectCallCount: (probe.injectCalls ?? []).length,
    anyInjectCallbackFired: (probe.injectCalls ?? []).some((entry) => entry.callbackFired === true),
    cardRenderStates: probe.cardStates ?? [],
    directoryLoads: probe.directoryLoads ?? [],
    probeWarnings: (probe.warnings ?? []).map((entry) => entry.text),
    probeErrors: (probe.errors ?? []).map((entry) => entry.text),
    probeNotes: probe.notes ?? [],
  }
  say("MEASUREMENT E: mpd bundles=" + JSON.stringify(result.measurementE.mpdBundlesArrived.map((entry) => entry.id)) + " ctxCaptured=" + String(probe.ctxCaptured) + " injectWrapped=" + String(probe.injectWrapped))
  say("MEASUREMENT E: card inject calls=" + JSON.stringify(cardInjectCalls.map((entry) => ({ deps: entry.dependencies, fired: entry.callbackFired, scoped: entry.scoped }))))
  say("MEASUREMENT E: card render states=" + JSON.stringify((probe.cardStates ?? []).map((state) => [state.state, state.providers, state.models, state.text, state.why])))
  for (const warning of result.measurementE.probeWarnings) say("PROBE WARN: " + warning.slice(0, 300))
  for (const error of result.measurementE.probeErrors) say("PROBE ERROR: " + error.slice(0, 300))

  result.bootFaults = ["did not activate", "Failed to load plugins", "pending (waiting for service"].filter((needle) => readBootLog().includes(needle))
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
        bodyText: await session.evaluate("document.body ? document.body.innerText.slice(0, 1500) : null").catch(() => null),
        probe: await session.evaluate("window.__MPD_PROBE__ ? JSON.parse(JSON.stringify({ ...window.__MPD_PROBE__, readCard: undefined })) : null").catch(() => null),
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
  const brief = {
    ok: result.ok, error: result.error ?? null,
    phase1: result.measurementB?.card?.found === true ? { text: result.measurementB.card.statusText, attrs: result.measurementB.card.catalogAttributes, providers: result.measurementB.card.providerValuesBySelect } : (result.measurementB?.card ?? null),
    phase3: result.measurementBAfterSession?.card?.found === true ? { text: result.measurementBAfterSession.card.statusText, attrs: result.measurementBAfterSession.card.catalogAttributes, providers: result.measurementBAfterSession.card.providerValuesBySelect } : (result.measurementBAfterSession?.card ?? null),
    stateInjection: result.phase2?.stateInjection ?? null,
    sessionsBefore: result.sessionsShapeBefore?.currentSessionId ?? null,
    sessionsAfter: result.phase2?.sessionsShapeAfter?.currentSessionId ?? null,
    C: result.measurementC ? { rpcProviders: result.measurementC.rpc?.providerCount ?? null, rpcModels: result.measurementC.rpc?.modelCount ?? null, service: result.measurementC.service ?? null } : null,
    D: result.measurementD ? { total: result.measurementD.total, errors: result.measurementD.errors.length, warnings: result.measurementD.warnings.length } : null,
    E: result.measurementE ? { mpd: result.measurementE.mpdBundlesArrived.map((entry) => entry.id), ctxCaptured: result.measurementE.ctxCaptured, cardInjectCalls: result.measurementE.cardInjectCalls.map((entry) => ({ deps: entry.deps, fired: entry.callbackFired, currentSession: entry.scoped?.currentSession ?? null, directoryFound: entry.scoped?.directoryFound ?? null, snapshot: entry.scoped?.directorySnapshot ?? null })), cardRenderStates: result.measurementE.cardRenderStates } : null,
  }
  console.log(JSON.stringify(brief, null, 2))
}
process.exit(result.ok === true ? 0 : 1)
