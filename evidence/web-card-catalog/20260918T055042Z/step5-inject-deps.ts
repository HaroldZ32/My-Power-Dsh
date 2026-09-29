#!/usr/bin/env bun
// web-card-catalog lane — STEP 5: the FIX HYPOTHESIS, measured.
//
// step4 pinned the failure: with a session current, the card's
//   ctx.inject(["modelDirectories","sessions"], scoped => … scoped.get("modelDirectories").directoryFor(sessionId))
// throws `cannot get property "remote.session" without inject`, so the card falls back.
//
// The host service that owns `directoryFor` declares
//   static inject = ["sessions", "remote", "remote.session"]
// (`@deepseek-ai/dsh-client-ui-model-selection/lib/client.js`, class `ModelDirectoryResolver`).
// cordis resolves a service's own `this.ctx.<dep>` through the CALLER-scoped context, so a caller
// that injected ONLY `modelDirectories`+`sessions` cannot drive `directoryFor`.
//
// This step measures that claim by calling `directoryFor` through several dependency lists on the
// SAME captured ctx and the SAME current session, and reports which one works (and what the
// directory then contains).
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
const say = (line) => { const text = "[deps] " + line; console.log(text); try { appendFileSync(LOG, text + "\n") } catch { /* best effort */ } }
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
const result = { step: "inject-deps", chromeBinary: CHROME }
const hostPort = await freePort()
const bootLog = join(RAW, "host-boot-deps.log")
rmSync(bootLog, { force: true })
const bootFd = openSync(bootLog, "a")
const host = spawn("dsh", ["--profile", "web", "--port", String(hostPort), "--no-open"], {
  env: { ...process.env, DSH_HOME, HOME: USER_HOME }, cwd: WS, stdio: ["ignore", bootFd, bootFd],
})
const base = "http://127.0.0.1:" + String(hostPort)
const readBootLog = () => { try { return readFileSync(bootLog, "utf8") } catch { return "" } }
result.hostPort = hostPort
say("host port=" + String(hostPort))

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
  const createSession = async () => {
    const response = await fetch(base + "/api/session/create", {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ type: "client-request", rpcId: "deps-" + String(Date.now()) + "-" + String(Math.random()), method: "session/create", payload: { args: { request: { cwd: WS, agentPreset: "mpd" } } } }),
      signal: AbortSignal.timeout(60000),
    })
    const envelope = await response.json().catch(() => ({}))
    return envelope?.result?.value?.sessionId ?? envelope?.result?.sessionId ?? null
  }
  // ONE SESSION PER CANDIDATE: `directoryFor` CACHES a directory per sessionId and returns it
  // before touching `this.ctx`, so a shared session would let the first success serve every later
  // candidate out of the cache and make the sweep meaningless.
  const candidateDeps = [
    ["modelDirectories", "sessions"],
    ["modelDirectories", "sessions", "remote"],
    ["modelDirectories", "sessions", "remote.session"],
    ["modelDirectories", "sessions", "remote", "remote.session"],
    ["sessions", "remote", "remote.session"],
  ]
  const hostSessionIds = []
  for (let index = 0; index < candidateDeps.length; index += 1) hostSessionIds.push(await createSession())
  result.hostSessionIds = hostSessionIds
  say("host sessions: " + JSON.stringify(hostSessionIds))

  const chromePort = await freePort()
  const chromeProfile = join(SAND, "chromium-profile-deps")
  rmSync(chromeProfile, { recursive: true, force: true })
  const chromeFd = openSync(join(RAW, "chromium-deps.log"), "a")
  chrome = spawn(CHROME, [
    "--headless", "--remote-debugging-port=" + String(chromePort), "--no-sandbox", "--disable-setuid-sandbox",
    "--disable-gpu", "--disable-dev-shm-usage", "--remote-allow-origins=*", "--no-first-run",
    "--no-default-browser-check", "--window-size=1680,1050", "--user-data-dir=" + chromeProfile, "about:blank",
  ], { stdio: ["ignore", chromeFd, chromeFd] })
  result.chromePort = chromePort
  const attached = await attachToPage(chromePort, { timeoutMs: 30000, log: say })
  session = attached.session
  await session.send("Page.enable")
  await session.send("Runtime.enable")
  await session.send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(join(EVID, "probe-hook.js"), "utf8") })
  await session.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false })
  await session.send("Page.navigate", { url: base + "/?token=" + encodeURIComponent(token) })
  await session.waitFor("document.querySelectorAll('button[aria-haspopup=\"dialog\"]').length > 0", { timeoutMs: 90000, label: "hydration" })
  await sleep(3000)
  say("hydrated; captured ctx = " + String(await session.evaluate("!!window.__MPD_CTX__")))

  // Making a session current goes through the store the card itself reads (measured to work in
  // step 4). This is a state injection through the app's own service — explicitly NOT a UI drive.
  const makeCurrent = async (sessionId) => session.evaluate(`(() => {
    const scoped = window.__MPD_SCOPED__;
    const sessions = scoped.get("sessions");
    const before = sessions.list.getSnapshot();
    sessions.list.set(Object.assign({}, before, { current: { sessionId: ${JSON.stringify("PLACEHOLDER")} } }));
    const after = sessions.list.getSnapshot();
    return { before: before.current ?? null, afterId: after.current?.sessionId ?? after.current?.id ?? null };
  })()`.replace("PLACEHOLDER", sessionId))
  result.makeCurrent = await makeCurrent(hostSessionIds[0])
  say("make current (candidate 0): " + JSON.stringify(result.makeCurrent))

  // One dependency list per call, in ARRAY ORDER, each with its own try/catch in the page.
  await session.evaluate(`(() => { window.__DEPS_CANDIDATES__ = ${JSON.stringify([["modelDirectories","sessions"],["modelDirectories","sessions","remote"],["modelDirectories","sessions","remote.session"],["modelDirectories","sessions","remote","remote.session"],["sessions","remote","remote.session"]])}; window.__DEPS_SESSIONS__ = ${JSON.stringify(null)}; return true; })()`)
  await session.evaluate(`(() => { window.__DEPS_SESSIONS__ = ${JSON.stringify(result.hostSessionIds)}; return true; })()`)
  result.injectDependencySweep = await session.evaluate(`(async () => {
    const ctx = window.__MPD_CTX__;
    const candidates = window.__DEPS_CANDIDATES__;
    const sessionFor = window.__DEPS_SESSIONS__;
    const results = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const deps = candidates[index];
      const scopedCtx = window.__MPD_SCOPED__;
      const list = scopedCtx.get("sessions").list;
      list.set(Object.assign({}, list.getSnapshot(), { current: { sessionId: sessionFor[index] } }));
      const entry = await new Promise((resolvePromise) => {
        const record = { deps, callbackFired: false };
        const timer = setTimeout(() => resolvePromise(Object.assign(record, { timedOut: true })), 12000);
        try {
          ctx.inject(deps, (scoped) => {
            clearTimeout(timer);
            record.callbackFired = true;
            try {
              const directories = scoped.get("modelDirectories");
              record.directoryService = typeof directories;
              const sessions = scoped.get("sessions");
              const snapshot = sessions.list.getSnapshot();
              const sessionId = snapshot.current?.sessionId ?? snapshot.current?.id ?? null;
              record.sessionId = sessionId;
              const directory = directories.directoryFor(sessionId);
              record.directoryForThrew = false;
              record.directoryFound = directory !== undefined && directory !== null;
              const storeSnapshot = directory?.store?.getSnapshot?.();
              const groups = storeSnapshot?.value?.groups ?? storeSnapshot?.groups ?? [];
              record.beforeLoad = { status: storeSnapshot?.status ?? null, groupCount: Array.isArray(groups) ? groups.length : null };
              Promise.resolve(directory.load()).then(() => {
                const after = directory.store.getSnapshot();
                const afterGroups = after?.value?.groups ?? after?.groups ?? [];
                record.afterLoad = { status: after?.status ?? null, groupCount: Array.isArray(afterGroups) ? afterGroups.length : null,
                  groups: Array.isArray(afterGroups) ? afterGroups.map((group) => ({ id: group?.id ?? null, models: (group?.models ?? []).length })) : [] };
                resolvePromise(record);
              }, (error) => { record.loadError = String(error?.message ?? error); resolvePromise(record); });
            } catch (error) {
              record.directoryForThrew = true;
              record.error = String(error?.message ?? error);
              resolvePromise(record);
            }
          });
        } catch (error) { clearTimeout(timer); resolvePromise(Object.assign(record, { injectThrew: String(error?.message ?? error) })); }
      });
      results.push(entry);
      await new Promise((done) => setTimeout(done, 500));
    }
    return results;
  })()`)
  for (const entry of result.injectDependencySweep) {
    say("deps=" + JSON.stringify(entry.deps) + " fired=" + String(entry.callbackFired) + " directoryForThrew=" + String(entry.directoryForThrew ?? null) + " error=" + String(entry.error ?? entry.injectThrew ?? entry.loadError ?? "none") + " afterLoad=" + JSON.stringify(entry.afterLoad ?? null))
  }
  result.ok = result.injectDependencySweep.some((entry) => entry.directoryForThrew === false && (entry.afterLoad?.groupCount ?? 0) > 0)
} catch (error) {
  result.ok = false
  result.error = String(error?.stack ?? error?.message ?? error)
  say("FAILED: " + String(error?.message ?? error))
} finally {
  try { session?.dispose() } catch { /* ignore */ }
  try { chrome?.kill("SIGKILL") } catch { /* ignore */ }
  try { host.kill("SIGKILL") } catch { /* ignore */ }
  writeFileSync(join(RAW, "step5-inject-deps.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(JSON.stringify({ ok: result.ok, error: result.error ?? null, makeCurrent: result.makeCurrent ?? null, sweep: (result.injectDependencySweep ?? []).map((entry) => ({ deps: entry.deps, fired: entry.callbackFired, threw: entry.directoryForThrew ?? null, error: entry.error ?? entry.injectThrew ?? entry.loadError ?? null, afterLoad: entry.afterLoad ?? null })) }, null, 2))
}
