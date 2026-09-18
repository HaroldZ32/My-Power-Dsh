#!/usr/bin/env bun
// web-card-catalog lane (FIX VERIFICATION) — the ACCEPTANCE read.
//
// Goal: with the FIXED client bytes served, render the Web "MPD settings" section in a REAL browser
// while a session IS CURRENT, and read the catalog status line + the three slot provider pickers.
//
// Why a separate driver: step3 (the reproducing lane) reads the card BEFORE a session exists
// (phase 1) and then re-opens the dialog after the session injection, where its nav locator failed
// ("no visible MPD nav button"). This driver mounts the card FIRST (which captures the app's own
// scoped ctx), binds the session through the app's own sessions store — the workspace picker is a
// native dialog headless CDP cannot operate, so this is an EXPLICIT state injection, not a UI drive
// — then re-opens the section and reads the card.
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
const LOG = join(EVID, "step7.log")
const say = (line) => { const text = "[step7] " + line; console.log(text); try { appendFileSync(LOG, text + "\n") } catch { /* best effort */ } }
mkdirSync(RAW, { recursive: true })

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const redact = (text) => String(text).replace(/token=[A-Za-z0-9_-]+/g, "token=<redacted>")
const result = { step: "acceptance", roots: { DSH_HOME, HOME: USER_HOME, workspace: WS }, servedClient: null, phases: {}, console: {}, verdict: null, ok: null, error: null }

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

/** The card read: status line, its data attributes, and every <select> in the same dialog. */
const CARD_READ = `(() => {
  const status = document.querySelector('[data-mpd-catalog-state]');
  if (status === null) return { found: false };
  const attrs = {};
  for (const attribute of status.attributes) attrs[attribute.name] = attribute.value;
  const dialog = status.closest('[role="dialog"]') ?? document;
  const selects = [...dialog.querySelectorAll('select')].map((el, index) => ({
    index, ariaLabel: el.getAttribute('aria-label'),
    options: [...el.options].map((option) => ({ value: option.value, label: option.textContent })),
  }));
  return { found: true, at: Date.now(), statusText: (status.textContent ?? '').trim(), catalogAttributes: attrs, selectCount: selects.length, selects };
})()`

/** Every <select> in the section, verbatim, tagged with the field row it belongs to. */
const ALL_SELECTS_READ = `(() => {
  const status = document.querySelector('[data-mpd-catalog-state]');
  const dialog = status === null ? document : (status.closest('[role="dialog"]') ?? document);
  const selects = [...dialog.querySelectorAll('select')];
  return selects.map((select, index) => {
    let key = null;
    let node = select;
    for (let up = 0; up < 8 && node !== null; up += 1) {
      const text = node.parentElement === null ? "" : node.parentElement.textContent || "";
      const match = /(teamModels\\.slot[123]\\.(provider|model|reasoningEffort)|hashline\\.[A-Za-z]+|commentChecker\\.[A-Za-z]+|ulw\\.[A-Za-z]+|memory\\.[A-Za-z]+|team\\.[A-Za-z]+|boulder\\.[A-Za-z]+|watchdog\\.[A-Za-z.]*)/.exec(text);
      if (match !== null) { key = match[1]; break; }
      node = node.parentElement;
    }
    return { index, key, value: select.value, optionCount: select.options.length, options: [...select.options].map((option) => ({ value: option.value, label: option.textContent })) };
  });
})()`

/** Click the MPD nav entry through the DOM (visible-or-not), so a scrolled nav cannot hide it. */
const CLICK_MPD_NAV = `(() => {
  const leaves = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && (el.textContent || '').trim() === 'MPD');
  const visible = leaves.find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const target = visible ?? leaves[0] ?? null;
  if (target === null) return { clicked: false, leafCandidates: leaves.length, navTexts: [...document.querySelectorAll('[role="dialog"] button, [role="dialog"] [role="menuitem"], [role="dialog"] [role="tab"]')].map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim()).filter((t) => t !== '').slice(0, 40) };
  const clickable = target.closest('button,[role="menuitem"],[role="tab"],a,li') ?? target;
  clickable.scrollIntoView({ block: 'center' });
  clickable.click();
  return { clicked: true, tag: clickable.tagName, text: (clickable.textContent || '').trim().slice(0, 40), visible: visible !== undefined };
})()`

const OPEN_SETTINGS = `(() => {
  const all = [...document.querySelectorAll('button, [role="button"], [role="menuitem"], a')];
  const trigger = all.find((el) => el.getAttribute('aria-label') === 'Settings') ?? all.find((el) => /settings/i.test(el.getAttribute('aria-label') ?? '') || /settings/i.test((el.textContent || '').trim()));
  if (trigger === undefined) return { clicked: false, candidates: all.length };
  trigger.scrollIntoView({ block: 'center' });
  trigger.click();
  return { clicked: true, text: (trigger.textContent || '').trim().slice(0, 40), ariaLabel: trigger.getAttribute('aria-label') };
})()`

const HOST_SERVED_MARKERS = (text) => ({
  bytes: Buffer.byteLength(text),
  cardChain: (text.match(/ctx\.inject\(\["modelDirectories", "sessions", "remote\.session"\]/g) ?? []).length,
  teamChain: (text.match(/ctx\.inject\(\["modelDirectories", "remote\.session"\]/g) ?? []).length,
  preFixCardList: (text.match(/ctx\.inject\(\["modelDirectories", "sessions"\]/g) ?? []).length,
  preFixTeamList: (text.match(/ctx\.inject\(\["modelDirectories"\]/g) ?? []).length,
  dataCatalogAttr: (text.match(/data-mpd-catalog-state/g) ?? []).length,
  settingsKnobs: (text.match(/SETTINGS_KNOBS/g) ?? []).length,
})

const hostPort = await freePort()
const bootLog = join(RAW, "step7-host-boot.log")
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
      body: JSON.stringify({ type: "client-request", rpcId: "mpd-accept-" + String(Date.now()), method, payload: { args } }),
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
  // MEASUREMENT A (re-run): the bytes the host SERVES for the bundle client, discovered from the
  // app's own index HTML (the served path is a combo URL, not a guessable one).
  const indexHtml = await (await fetch(base + "/", { headers: cookie === "" ? {} : { cookie } })).text()
  const urls = [...new Set([...indexHtml.matchAll(/\/plugins\/[^\s"'<>\\]*client\.js[^\s"'<>\\]*/g)].map((m) => m[0]))]
  const mpdUrls = urls.filter((url) => decodeURIComponent(url).includes("@mpd-dsh/mpd")).sort((l, r) => Number(l.includes(",@")) - Number(r.includes(",@")))
  const fetched = []
  for (const url of mpdUrls) {
    const response = await fetch(base + url, { headers: cookie === "" ? {} : { cookie } })
    const body = await response.text()
    fetched.push({ url: redact(url), isCombo: url.includes(",@"), status: response.status, ...HOST_SERVED_MARKERS(body) })
    if (response.status === 200 && !url.includes(",@")) writeFileSync(join(RAW, "step7-served-client.js"), body)
  }
  result.servedClient = { mpdClientUrls: fetched }
  say("SERVED client: " + JSON.stringify(fetched))
  const servedOk = fetched.some((entry) => entry.status === 200 && entry.cardChain > 0 && entry.teamChain > 0 && entry.preFixCardList === 0 && entry.preFixTeamList === 0 && entry.settingsKnobs === 0)
  if (!servedOk) say("WARNING: no served @mpd-dsh/mpd bundle carried the expected fixed markers")

  const chromePort = await freePort()
  const chromeProfile = join(SAND, "chromium-profile-accept")
  const chromeFd = openSync(join(RAW, "step7-chromium.log"), "a")
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
  await sleep(2500)

  const openSection = async (label) => {
    const open = await session.evaluate(OPEN_SETTINGS)
    await session.waitFor("document.querySelector('[role=\"dialog\"]') !== null", { timeoutMs: 20000, label: "the settings dialog (" + label + ")" })
    await sleep(1200)
    const nav = await session.evaluate(CLICK_MPD_NAV)
    await session.waitFor("document.querySelector('[data-mpd-catalog-state]') !== null", { timeoutMs: 25000, label: "the mpd catalog status paragraph (" + label + ")" })
    return { open, nav }
  }
  const pressEscape = async () => {
    for (const type of ["keyDown", "keyUp"]) {
      await session.send("Input.dispatchKeyEvent", { type, windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27, key: "Escape", code: "Escape" })
    }
    await sleep(900)
  }
  const sampleCard = async (ticks) => {
    const samples = []
    let previous = null
    for (let tick = 0; tick < ticks; tick += 1) {
      await sleep(1000)
      const read = await session.evaluate(CARD_READ)
      const line = read.found === true ? read.statusText : "(no card)"
      if (line !== previous) { samples.push({ tick, statusText: line, attrs: read.catalogAttributes ?? null }); previous = line }
      if (read.found === true && String(read.statusText).startsWith("live catalog")) break
    }
    return samples
  }

  // ── PHASE A: mount the section ONCE (captures the app's own scoped ctx), read the baseline ────
  const phaseA = await openSection("phase-a-before-session")
  result.phases.openA = phaseA
  result.phases.cardBeforeSession = await session.evaluate(CARD_READ)
  say("PHASE A card: " + JSON.stringify(result.phases.cardBeforeSession.statusText ?? result.phases.cardBeforeSession))
  await session.screenshot(join(RAW, "step7-phaseA-before-session.png"))
  await pressEscape()

  // ── PHASE B: a FRESH session through the app's own RPC, made CURRENT through its own store ────
  const created = await rpc("session/create", { request: { cwd: WS, agentPreset: "mpd" } }, cookie)
  const createdId = created.result?.value?.sessionId ?? created.result?.sessionId ?? null
  const injectCurrent = (id) => `(() => {
    const scoped = window.__MPD_SCOPED__;
    const svc = scoped && typeof scoped.get === 'function' ? scoped.get('sessions') : undefined;
    if (!svc) return { hasService: false, hasScoped: scoped !== undefined };
    const before = svc.list.getSnapshot();
    svc.list.set(Object.assign({}, before, { current: { sessionId: ${JSON.stringify(id)} } }));
    const after = svc.list.getSnapshot();
    return { hasService: true, beforeId: before.current?.sessionId ?? null, afterId: after.current?.sessionId ?? null, ids: Array.isArray(after.ids) ? after.ids.length : null };
  })()`
  const injected = await session.evaluate(injectCurrent(createdId))
  result.phases.sessionBinding = {
    method: "EXPLICIT state injection through the app's own sessions store (sessions.list.set) on the captured scoped ctx — NOT a UI drive; the workspace picker is a native dialog headless CDP cannot operate",
    hostSessionCreated: createdId, rpcStatus: created.status, injected,
  }
  say("SESSION binding: " + JSON.stringify(result.phases.sessionBinding))
  const readBack = await session.evaluate(`(() => { const svc = window.__MPD_SCOPED__ && window.__MPD_SCOPED__.get('sessions'); if (!svc) return null; const s = svc.list.getSnapshot(); return { currentId: s.current?.sessionId ?? null }; })()`)
  result.phases.sessionsAfterBinding = readBack
  say("sessions after binding: " + JSON.stringify(readBack))
  await sleep(1500)

  // ── PHASE C: re-open the section with the session CURRENT and read the card ──────────────────
  const phaseC = await openSection("phase-c-with-session")
  result.phases.openC = phaseC
  result.phases.cardSamples = await sampleCard(24)
  const card = await session.evaluate(CARD_READ)
  const allSelects = await session.evaluate(ALL_SELECTS_READ)
  result.phases.card = card
  result.phases.allSelects = allSelects
  result.phases.slotProviderSelects = allSelects.filter((select) => select.key !== null && /^teamModels\.slot[123]\.provider$/.test(select.key))
  say("PHASE C STATUS: " + JSON.stringify(card.found === true ? card.statusText : card))
  say("PHASE C ATTRS: " + JSON.stringify(card.catalogAttributes ?? null))
  say("PHASE C SLOT PROVIDERS: " + JSON.stringify(result.phases.slotProviderSelects.map((s) => ({ key: s.key, options: s.options.map((o) => o.value) }))))
  await session.screenshot(join(RAW, "step7-phaseC-card-with-session.png"))
  const dialogHtml = await session.evaluate("(() => { const node = document.querySelector('[data-mpd-catalog-state]'); const el = node === null ? null : node.closest('[role=\"dialog\"]'); return el === null ? null : el.outerHTML; })()")
  if (typeof dialogHtml === "string") writeFileSync(join(RAW, "step7-settings-dialog.html"), dialogHtml)

  // ── the browser's own catalog (the ground truth the card must mirror) ────────────────────────
  const browserCatalog = await session.evaluate(`(async () => {
    const response = await fetch("/api/session/modelCatalog", {
      method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ type: "client-request", rpcId: "mpd-accept-catalog", method: "session/modelCatalog", payload: { args: {} } }),
    });
    const envelope = await response.json();
    const value = envelope?.result?.value ?? envelope?.result ?? null;
    const groups = Array.isArray(value?.groups) ? value.groups : [];
    return { status: response.status, providers: groups.length, models: groups.reduce((total, group) => total + (Array.isArray(group.models) ? group.models.length : 0), 0), providerIds: groups.map((group) => group.id) };
  })()`)
  result.phases.browserCatalog = browserCatalog
  say("BROWSER catalog: " + JSON.stringify(browserCatalog))

  const mpdConsole = consoleEvents.filter((event) => /\[mpd\]/i.test(event.text))
  result.console = { total: consoleEvents.length, mpdPrefixed: mpdConsole, cardErrors: consoleEvents.filter((event) => /data-mpd-catalog|catalog could not|directoryFor/i.test(event.text)) }
  say("CONSOLE: total=" + String(consoleEvents.length) + " mpd=" + String(mpdConsole.length))

  // ── VERDICT ──────────────────────────────────────────────────────────────────────────────────
  const statusText = card.found === true ? String(card.statusText) : ""
  const providerValues = new Set()
  for (const select of result.phases.slotProviderSelects) for (const option of select.options) if (option.value !== "") providerValues.add(option.value)
  result.verdict = {
    servedBytesCarryFix: servedOk,
    cardFound: card.found === true,
    statusLine: statusText,
    liveCatalogLine: statusText.startsWith("live catalog"),
    catalogStateAttribute: card.catalogAttributes?.["data-mpd-catalog-state"] ?? null,
    catalogProvidersAttribute: card.catalogAttributes?.["data-mpd-catalog-providers"] ?? null,
    catalogModelsAttribute: card.catalogAttributes?.["data-mpd-catalog-models"] ?? null,
    slotProviderSelectCount: result.phases.slotProviderSelects.length,
    distinctSlotProviderValues: [...providerValues],
    offersMoreThanDeepseekOfficial: providerValues.size > 1,
    cardEmittedMpdConsole: mpdConsole.length > 0,
    browserCatalog,
  }
  result.ok = servedOk && result.verdict.cardFound === true && result.verdict.liveCatalogLine === true && result.verdict.offersMoreThanDeepseekOfficial === true && mpdConsole.length === 0
  say("VERDICT: " + JSON.stringify(result.verdict))
} catch (error) {
  result.ok = false
  result.error = String(error?.stack ?? error?.message ?? error)
  say("FAILED: " + result.error)
} finally {
  writeFileSync(join(RAW, "step7-result.json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(RAW, "step7-console.json"), JSON.stringify(consoleEvents, null, 2) + "\n")
  try { if (session !== null) await session.send("Browser.close") } catch { /* best effort */ }
  try { chrome?.kill("SIGKILL") } catch { /* best effort */ }
  try { host.kill("SIGKILL") } catch { /* best effort */ }
  await sleep(500)
  say("done ok=" + String(result.ok))
  process.exit(result.ok === true ? 0 : 1)
}
