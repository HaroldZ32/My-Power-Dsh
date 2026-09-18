#!/usr/bin/env bun
// web-card-catalog lane — STEP 4: isolate WHERE the card's live-catalog chain stops.
//
// step3 proved (in a REAL browser, against the REAL sandboxed host):
//   • the card renders the DECLARED fallback (one provider) with the status line
//     `declared fallback — live catalog unavailable (no session is bound)`;
//   • the browser-side catalog really carries TWO providers;
//   • `ctx.inject(["modelDirectories","sessions"], cb)` DOES fire its callback.
// What is left is the BINDING: `currentSessionIdOf(sessions)` reads
// `sessions.list.getSnapshot().current`, and in this page that is null because the app has no
// workspace selected (its composer literally says "Choose a workspace to start", and the workspace
// picker is a native dialog that cannot be driven from a headless CDP session).
//
// So this step answers the remaining question with an EXPLICIT state injection — never presented as
// a UI drive: it introspects the client's own `sessions`/`workspaces` services, creates a real
// session on the HOST through the same RPC the app uses, and then tries, ONE AT A TIME and each in
// its own try/catch, every plausible way the app's own services offer to make that session current.
// After each attempt it reads `sessions.list.getSnapshot().current` and, once a session IS current,
// it re-renders the mpd section and records whether the card's status line turns LIVE.
import { appendFileSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
const say = (line) => { const text = "[bind] " + line; console.log(text); try { appendFileSync(LOG, text + "\n") } catch { /* best effort */ } }
mkdirSync(RAW, { recursive: true })
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
const result = { step: "bind-probe", chromeBinary: CHROME, roots: { DSH_HOME, HOME: USER_HOME, workspace: WS } }

const hostPort = await freePort()
const bootLog = join(RAW, "host-boot-bind.log")
rmSync(bootLog, { force: true })
const bootFd = openSync(bootLog, "a")
const host = spawn("dsh", ["--profile", "web", "--port", String(hostPort), "--no-open"], {
  env: { ...process.env, DSH_HOME, HOME: USER_HOME }, cwd: WS, stdio: ["ignore", bootFd, bootFd],
})
const base = "http://127.0.0.1:" + String(hostPort)
const readBootLog = () => { try { return readFileSync(bootLog, "utf8") } catch { return "" } }
result.hostPid = host.pid
result.hostPort = hostPort
say("host pid=" + String(host.pid) + " port=" + String(hostPort))

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
    if (token === "") throw new Error("no launch token within 180 s")
  }

  // A REAL session on the host, created through the app's own RPC (no model completion is issued:
  // creating a session starts no turn).
  const rpc = async (method, args) => {
    const response = await fetch(base + "/api/" + method, {
      method: "POST", headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
      body: JSON.stringify({ type: "client-request", rpcId: "bind-" + method.replace("/", "-") + "-" + String(Date.now()), method, payload: { args } }),
      signal: AbortSignal.timeout(60000),
    }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.cause?.code ?? error?.message ?? error) }) }))
    const envelope = await response.json().catch(() => ({}))
    return { status: response.status, result: envelope?.result ?? null, error: envelope?.error ?? null }
  }
  const create = await rpc("session/create", { request: { cwd: WS, agentPreset: "mpd" } })
  const hostSessionId = create.result?.sessionId ?? create.result?.value?.sessionId ?? create.result?.id ?? null
  result.hostSession = { status: create.status, sessionId: hostSessionId, raw: JSON.stringify(create.result).slice(0, 400) }
  say("host session/create -> " + JSON.stringify(result.hostSession))

  const chromePort = await freePort()
  const chromeProfile = join(SAND, "chromium-profile-bind")
  rmSync(chromeProfile, { recursive: true, force: true })
  const chromeFd = openSync(join(RAW, "chromium-bind.log"), "a")
  chrome = spawn(CHROME, [
    "--headless", "--remote-debugging-port=" + String(chromePort), "--no-sandbox", "--disable-setuid-sandbox",
    "--disable-gpu", "--disable-dev-shm-usage", "--remote-allow-origins=*", "--no-first-run",
    "--no-default-browser-check", "--window-size=1680,1050", "--user-data-dir=" + chromeProfile, "about:blank",
  ], { stdio: ["ignore", chromeFd, chromeFd] })
  result.chromePid = chrome.pid
  result.chromePort = chromePort
  try {
    result.chromeVersion = (await (await fetch("http://127.0.0.1:" + String(chromePort) + "/json/version", { signal: AbortSignal.timeout(4000) })).json()).Browser ?? null
  } catch { /* null */ }

  const attached = await attachToPage(chromePort, { timeoutMs: 30000, log: say })
  session = attached.session
  await session.send("Page.enable")
  await session.send("Runtime.enable")
  const hookSource = readFileSync(join(EVID, "probe-hook.js"), "utf8")
  await session.send("Page.addScriptToEvaluateOnNewDocument", { source: hookSource })
  await session.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false })
  await session.send("Page.navigate", { url: base + "/?token=" + encodeURIComponent(token) })
  await session.waitFor("document.querySelectorAll('button[aria-haspopup=\"dialog\"]').length > 0", { timeoutMs: 90000, label: "hydration" })
  await sleep(3000)
  say("hydrated")

  // ── A: deep introspection of the app's own services, through the card's scoped ctx ────────
  result.introspection = await session.evaluate(`(() => {
    const scoped = window.__MPD_SCOPED__;
    if (scoped === undefined || scoped === null) return { scoped: "MISSING" };
    const describe = (value, depth) => {
      if (value === undefined) return "undefined";
      if (value === null) return "null";
      const type = typeof value;
      if (type !== "object" && type !== "function") return type;
      if (depth <= 0) return type;
      const keys = Object.keys(value).slice(0, 40);
      const out = {};
      for (const key of keys) {
        let entry;
        try { entry = value[key]; } catch (error) { out[key] = "THROWS: " + String(error.message); continue; }
        out[key] = typeof entry === "function" ? "function/" + String(entry.length) : describe(entry, depth - 1);
      }
      return out;
    };
    const sessions = scoped.get ? scoped.get("sessions") : undefined;
    const workspaces = scoped.get ? scoped.get("workspaces") : undefined;
    const snapshot = sessions?.list?.getSnapshot?.();
    return {
      sessions: describe(sessions, 2),
      workspaces: describe(workspaces, 2),
      listSnapshot: snapshot === undefined ? null : { keys: Object.keys(snapshot), ids: Array.isArray(snapshot.ids) ? snapshot.ids.slice(0, 10) : null, idCount: Array.isArray(snapshot.ids) ? snapshot.ids.length : null, byIdKeys: snapshot.byId === undefined || snapshot.byId === null ? null : Object.keys(snapshot.byId).slice(0, 10), current: snapshot.current ?? null, phase: snapshot.phase ?? null, currentAddress: snapshot.currentAddress ?? null },
    };
  })()`)
  say("introspection sessions keys: " + JSON.stringify(Object.keys(result.introspection.sessions ?? {})))
  say("introspection workspaces keys: " + JSON.stringify(Object.keys(result.introspection.workspaces ?? {})))
  say("introspection snapshot: " + JSON.stringify(result.introspection.listSnapshot))
  writeFileSync(join(RAW, "bind-introspection.json"), JSON.stringify(result.introspection, null, 2) + "\n")

  // ── B: the card BEFORE any binding ───────────────────────────────────────────────────────
  const readCard = async () => session.evaluate(`(() => {
    const node = document.querySelector('[data-mpd-catalog-state]');
    if (node === null) return { found: false };
    const attrs = {};
    for (const attribute of node.attributes) attrs[attribute.name] = attribute.value;
    const dialog = node.closest('[role="dialog"]') ?? document;
    const selects = [...dialog.querySelectorAll('select')].map((el) => ({ value: el.value, optionCount: el.options.length, providers: [...new Set([...el.options].map((option) => option.value.split('/')[0]))] }));
    return { found: true, text: (node.textContent ?? "").trim(), attrs, selects };
  })()`)
  const openMpd = async () => {
    const inv = await session.evaluate(`(() => [...document.querySelectorAll('button')].map((el, index) => { const r = el.getBoundingClientRect(); return { index, text: (el.textContent ?? "").trim().slice(0, 40), ariaLabel: el.getAttribute("aria-label"), visible: r.width > 0 && r.height > 0 }; }).filter((row) => row.visible && row.text !== ""))()`)
    const trigger = inv.find((row) => row.ariaLabel === "Settings")
    if (trigger === undefined) return { ok: false, reason: "no Settings trigger" }
    await session.clickSelector("button", { index: trigger.index })
    await sleep(1200)
    const inv2 = await session.evaluate(`(() => [...document.querySelectorAll('button')].map((el, index) => { const r = el.getBoundingClientRect(); return { index, text: (el.textContent ?? "").trim().slice(0, 40), visible: r.width > 0 && r.height > 0 }; }).filter((row) => row.visible && row.text === "MPD"))()`)
    if (inv2.length === 0) return { ok: false, reason: "no MPD nav button" }
    await session.clickSelector("button", { index: inv2[0].index })
    await sleep(2000)
    return { ok: true }
  }
  const opened = await openMpd()
  result.beforeBinding = { opened, card: await readCard() }
  say("card BEFORE binding: " + JSON.stringify(result.beforeBinding.card?.text) + " attrs=" + JSON.stringify(result.beforeBinding.card?.attrs))

  // ── C: try every plausible app-provided way to make the host session current ─────────────
  // Each attempt runs in its own try/catch INSIDE the page and is reported by its own name, so a
  // failure names the exact call. This is an EXPLICIT state injection through the app's own
  // services — it is NOT a UI drive, and it is labelled as such in the report.
  const attempts = await session.evaluate(`(async () => {
    const scoped = window.__MPD_SCOPED__;
    const sessions = scoped.get("sessions");
    const target = ${JSON.stringify(hostSessionId)};
    const observed = [];
    const readCurrent = () => {
      const snapshot = sessions.list.getSnapshot();
      return { current: snapshot.current ?? null, id: snapshot.current?.sessionId ?? snapshot.current?.id ?? null, currentAddress: snapshot.currentAddress ?? null, idCount: Array.isArray(snapshot.ids) ? snapshot.ids.length : null };
    };
    const attempt = async (name, fn) => {
      let outcome;
      try { outcome = await fn(); } catch (error) { outcome = { threw: String(error?.message ?? error) }; }
      observed.push({ name, outcome, after: readCurrent() });
      return observed[observed.length - 1];
    };
    const candidates = [
      ["sessions.selection.select(target)", () => sessions.selection.select(target)],
      ["sessions.selection.open(target)", () => sessions.selection.open(target)],
      ["sessions.selection.set(target)", () => sessions.selection.set(target)],
      ["sessions.manager.open(target)", () => sessions.manager.open(target)],
      ["sessions.manager.select(target)", () => sessions.manager.select(target)],
      ["sessions.manager.create({cwd: ws})", () => sessions.manager.create({ cwd: ${JSON.stringify(WS)} })],
      ["sessions.list.set({...snapshot, current:{sessionId:target}})", () => { const snapshot = sessions.list.getSnapshot(); return sessions.list.set(Object.assign({}, snapshot, { current: { sessionId: target } })); }],
      ["sessions.list.update(draft => draft.current = {sessionId:target})", () => sessions.list.update((draft) => { draft.current = { sessionId: target }; })],
    ];
    for (const [name, fn] of candidates) {
      const entry = await attempt(name, fn);
      const id = entry.after.id;
      if (id !== null && id !== undefined) return { observed, stoppedAt: name, currentId: id };
      await new Promise((done) => setTimeout(done, 800));
    }
    return { observed, stoppedAt: null, currentId: null };
  })()`)
  result.bindingAttempts = attempts
  say("binding attempts: " + JSON.stringify(attempts.observed?.map((entry) => ({ name: entry.name, outcome: entry.outcome, afterId: entry.after?.id ?? null })), null, 1))
  say("binding stopped at: " + String(attempts.stoppedAt) + " currentId=" + String(attempts.currentId))

  // ── D: with a session current, does the card's own chain produce a LIVE catalog? ─────────
  await sleep(4000)
  await session.evaluate("window.__MPD_SAMPLE_CARD__ && window.__MPD_SAMPLE_CARD__('after-binding')")
  // Force a fresh render of the section (the card's state lives in its own store, so re-opening the
  // dialog re-renders from the CURRENT catalog value).
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27, key: "Escape", code: "Escape" })
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27, key: "Escape", code: "Escape" })
  await sleep(1000)
  const reopened = await openMpd()
  result.afterBinding = { reopened, card: await readCard() }
  say("card AFTER binding: " + JSON.stringify(result.afterBinding.card?.text) + " attrs=" + JSON.stringify(result.afterBinding.card?.attrs))
  await session.screenshot(join(RAW, "bind-card-after-binding.png"))

  // ── E: an INDEPENDENT reach of the app's modelDirectories service, with the session current ─
  result.independentProbe = await session.evaluate(`(async () => {
    const ctx = window.__MPD_CTX__;
    return await new Promise((resolvePromise) => {
      const timer = setTimeout(() => resolvePromise({ timedOut: true }), 15000);
      ctx.inject(["modelDirectories", "sessions"], (scoped) => {
        clearTimeout(timer);
        try {
          const directories = scoped.get("modelDirectories");
          const sessions = scoped.get("sessions");
          const snapshot = sessions.list.getSnapshot();
          const sessionId = snapshot.current?.sessionId ?? snapshot.current?.id ?? null;
          const directory = sessionId === null ? undefined : directories.directoryFor(sessionId);
          const storeSnapshot = directory?.store?.getSnapshot?.();
          const groups = storeSnapshot?.value?.groups ?? storeSnapshot?.groups ?? [];
          resolvePromise({ fired: true, sessionId, hasDirectory: directory !== undefined && directory !== null, storeStatus: storeSnapshot?.status ?? null,
            providerCount: Array.isArray(groups) ? groups.length : null,
            modelCount: Array.isArray(groups) ? groups.reduce((total, group) => total + (Array.isArray(group?.models) ? group.models.length : 0), 0) : null,
            groups: Array.isArray(groups) ? groups.map((group) => ({ id: group?.id ?? null, models: (group?.models ?? []).map((model) => model?.id ?? null) })) : [] });
        } catch (error) { resolvePromise({ fired: true, error: String(error?.message ?? error) }); }
      });
    });
  })()`)
  say("independent probe: " + JSON.stringify(result.independentProbe).slice(0, 700))

  // ── F: the probe's own record: inject calls + every distinct card render state ────────────
  await session.evaluate("window.__MPD_SAMPLE_CARD__ && window.__MPD_SAMPLE_CARD__('final')")
  const probe = await session.evaluate("(() => { const p = window.__MPD_PROBE__; const { readCard, ...rest } = p; return JSON.parse(JSON.stringify(rest)); })()")
  writeFileSync(join(RAW, "bind-probe.json"), JSON.stringify(probe, null, 2) + "\n")
  result.probe = {
    mpdBundlesArrived: (probe.loaderLoadCalls ?? []).filter((entry) => String(entry.id).startsWith("@mpd-dsh/")).map((entry) => entry.id),
    ctxCaptured: probe.ctxCaptured, injectWrapped: probe.injectWrapped,
    cardInjectCalls: (probe.injectCalls ?? []).filter((entry) => Array.isArray(entry.dependencies) && entry.dependencies.includes("modelDirectories") && entry.dependencies.includes("sessions")).map((entry) => ({ at: entry.at, deps: entry.dependencies, fired: entry.callbackFired, scoped: entry.scoped ?? null })),
    cardRenderStates: probe.cardStates ?? [],
    directoryLoads: probe.directoryLoads ?? [],
    warnings: (probe.warnings ?? []).map((entry) => entry.text),
    errors: (probe.errors ?? []).map((entry) => entry.text),
    notes: probe.notes ?? [],
  }
  say("probe card render states: " + JSON.stringify(result.probe.cardRenderStates.map((state) => [state.state, state.providers, state.models, state.text, state.why])))
  say("probe card inject calls: " + JSON.stringify(result.probe.cardInjectCalls.map((entry) => ({ fired: entry.fired, session: entry.scoped?.currentSession ?? null, dirFound: entry.scoped?.directoryFound ?? null, groups: entry.scoped?.directorySnapshot?.groupCount ?? null }))))

  result.ok = true
} catch (error) {
  result.ok = false
  result.error = String(error?.stack ?? error?.message ?? error)
  say("FAILED: " + String(error?.message ?? error))
  try { if (session !== null) await session.screenshot(join(RAW, "bind-failure.png")) } catch { /* best effort */ }
} finally {
  try { session?.dispose() } catch { /* ignore */ }
  try { chrome?.kill("SIGKILL") } catch { /* ignore */ }
  try { host.kill("SIGKILL") } catch { /* ignore */ }
  writeFileSync(join(RAW, "step4-bind.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(JSON.stringify({ ok: result.ok, error: result.error ?? null, hostSession: result.hostSession?.sessionId ?? null, before: result.beforeBinding?.card?.text ?? null, attempts: (result.bindingAttempts?.observed ?? []).map((entry) => [entry.name, entry.outcome?.threw ?? entry.outcome ?? null, entry.after?.id ?? null]), stoppedAt: result.bindingAttempts?.stoppedAt ?? null, after: result.afterBinding?.card ?? null, independent: result.independentProbe ?? null, renderStates: result.probe?.cardRenderStates ?? null }, null, 2))
}
process.exit(result.ok === true ? 0 : 1)
