#!/usr/bin/env node
// Case web-client-adapt: prove the @mpd-dsh/mpd bundle's WEB CLIENT actually loads
// (this was structurally broken — the bundle declared dsh.client but had no loader
// entry named exactly '@mpd-dsh/mpd', so the boot graph never carried a client row):
//   1) offline self-test: mpd-web-compat self-row, manifest main/exports/client,
//      combined client.js registered ids + workmate slot ids, workmate host routes;
//   2) real web boot in a sandbox (DSH_HOME + HOME both sandboxed; manual copy, no
//      pnpm): assert the boot graph carries the @mpd-dsh/mpd client entry, /plugins/
//      @mpd-dsh/mpd/client.js serves and registers the matching id, and
//      /plugins/mpd-workmate/list (GET) + /plugins/mpd-workmate/init (POST) answer;
//      init creates ~/.mpd/workmate/<name> under the sandbox HOME; the real home is
//      never touched.
// Evidence -> evidence/plan-f/web-client-adapt/<ts>/. --self-test is offline.
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, dirname } from "node:path"

import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(dirname(dirname(__dirname)))
const PORT = 3185

function fail(msg) { console.error("[web-client-adapt] FAIL: " + msg); process.exit(1) }

function selfTest() {
  const checks = []
  const patch = readFileSync(join(ROOT, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  checks.push(["patch web-compat self-row", patch.includes("id: mpd-web-compat") && patch.includes("name: '@mpd-dsh/mpd'")])
  const pack = readFileSync(join(ROOT, "scripts", "pack-mpd.mjs"), "utf8")
  checks.push(["pack main -> mpd-bundle-plugin", pack.includes('main: "packages/mpd-bundle-plugin/dist/index.js"') && pack.includes('"./client": "./packages/mpd-bundle-plugin/client.js"') && pack.includes("mpd-bundle-plugin")])
  const client = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "client.js"), "utf8")
  checks.push(["combined client registers both ids", client.includes('id: "@nanmicoder/dsh-agent-teams"') && client.includes('id: "@mpd-dsh/mpd"')])
  checks.push(["combined client mounts workmate slots", client.includes("mpd-workmate-library") && client.includes("mpd-workmate-toggle") && client.includes("agentTeams.apply(ctx)")])
  // A declared-but-unregistered client service is FATAL: the web boot's
  // assertEntriesActive reports `entry: pending (waiting for service: X)` and throws
  // "Failed to load plugins", taking the whole page down. Drift-prone seams must
  // therefore be awaited with ctx.inject, never declared in the inject list.
  checks.push(["mpd client declares only stable seams", client.includes("const inject = REQUIRED_SERVICES.slice()")
    && client.includes('const REQUIRED_SERVICES = ["slots", "locale"]')])
  checks.push(["drift-prone seams are awaited, not declared", /const OPTIONAL_SERVICES = \["sessions", "conversationEvents", "modelDirectories"\]/.test(client)
    && client.includes("ctx.inject(OPTIONAL_SERVICES") && client.includes("serviceAvailable(ctx, name)")])
  checks.push(["agent-teams mount is contained", client.includes("agent-teams panel unavailable") && client.includes("failed to mount")])
  const wm = readFileSync(join(ROOT, "packages", "mpd-workmate-plugin", "src", "index.ts"), "utf8")
  checks.push(["workmate host routes", wm.includes("/plugins/mpd-workmate/list") && wm.includes("/plugins/mpd-workmate/init") && wm.includes("internal/service")])
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n)
  if (bad.length) fail("self-test: " + bad.join(" | "))
  console.log("[web-client-adapt self-test] ok: " + checks.length + " checks")
}

async function runReal() {
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(ROOT, "evidence", "plan-f", "web-client-adapt", ts)
  mkdirSync(outDir, { recursive: true })
  const home = join(ROOT, ".qa-web-client")
  const wmHome = mkdtempSync(join(tmpdir(), "mpd-wm-web-"))
  const profile = join(home, "profiles", "w")
  mkdirSync(profile, { recursive: true }); mkdirSync(join(home, ".agent-presets"), { recursive: true })
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  cpSync(join(homedir(), ".dsh", ".credentials.yaml"), join(home, ".credentials.yaml"))
  cpSync(join(ROOT, "dist", "mpd-package"), join(profile, "node_modules", "@mpd-dsh", "mpd"), { recursive: true })
  writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } } }, null, 2))
  const env = { ...process.env, DSH_HOME: home, HOME: wmHome }
  const log = join(outDir, "web.log")
  const fd = openSync(log, "w")
  const web = spawn("dsh", ["--profile", "w", "--port", String(PORT), "--no-open"], { env, cwd: ROOT, detached: false, stdio: ["ignore", fd, fd] })
  const steps = {}
  const t0 = Date.now()
  while (Date.now() - t0 < 90000) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const r = await fetch("http://127.0.0.1:" + PORT + "/plugins/mpd-workmate/list", { signal: AbortSignal.timeout(4000) })
      if (r.status === 200) { steps.listUp = { ok: true }; break }
    } catch { /* not up yet */ }
  }
  if (!steps.listUp) steps.listUp = { ok: false }
  // The root page is token-protected AND only becomes servable after the web
  // frontend finishes booting, so poll for it: a bare fetch returns 401/404 and
  // used to hide the whole assertion (this case reported `bootEntry: null` forever).
  let token = ""
  let entry = null, clientBody = "", clientStatus = 0, unregistered = [], rootHttp = 0
  // Client services this harness registers (verified against the live client Service
  // catalog). A boot row key that looks like a bare service name but is absent here is
  // exactly the drift that leaves an entry `pending`; `@scope/pkg` keys are module
  // dependencies, not services.
  const SERVICES = new Set(["layout", "locale", "sessions", "slots", "theme", "timer", "uiWorkspace", "workspaces"])
  const bootDeadline = Date.now() + 60000
  while (Date.now() < bootDeadline && entry === null) {
    try { token = /token=([A-Za-z0-9_-]+)/.exec(readFileSync(log, "utf8"))?.[1] ?? token } catch { /* log not flushed yet */ }
    try {
      const res = await fetch("http://127.0.0.1:" + PORT + "/?token=" + token, { signal: AbortSignal.timeout(8000) })
      rootHttp = res.status
      const html = await res.text()
      const bi = html.indexOf('globalThis["__DSH_BOOT__"]')
      if (bi >= 0) {
        const start = html.indexOf("{", bi)
        let depth = 0, end = -1
        for (let i = start; i < html.length; i++) { const c = html[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break } } }
        const boot = JSON.parse(html.slice(start, end))
        entry = boot.entries.find((e) => e.id === "@mpd-dsh/mpd") ?? null
        for (const e of boot.entries) {
          for (const key of e.inject ?? []) {
            if (!key.startsWith("@") && !SERVICES.has(key)) unregistered.push(e.id + ":" + key)
          }
        }
        if (entry) {
          // The combo route is revision-validated: dropping the rev query answers 404.
          const cres = await fetch("http://127.0.0.1:" + PORT + entry.url, { signal: AbortSignal.timeout(8000) })
          clientStatus = cres.status
          clientBody = await cres.text()
        }
      }
    } catch (e) { console.log("  boot fetch err:", e.message) }
    if (entry === null) await new Promise((r) => setTimeout(r, 2000))
  }
  steps.rootStatus = { ok: rootHttp === 200 && token !== "", http: rootHttp, tokenSeen: token !== "" }
  steps.bootEntry = { ok: entry !== null, id: entry?.id ?? null }
  steps.clientJs = {
    ok: clientStatus === 200 && clientBody.includes('id: "@mpd-dsh/mpd"') && clientBody.includes('id: "@nanmicoder/dsh-agent-teams"')
      && clientBody.includes("const inject = REQUIRED_SERVICES.slice()"),
    status: clientStatus,
  }
  // No entry may declare a service this harness does not register: that is the
  // `pending (waiting for service: X)` → "Failed to load plugins" failure.
  steps.noUnregisteredService = { ok: unregistered.length === 0, unregistered }
  // init route: POST creates the workmate under the SANDBOX HOME
  let initOk = false, initNote = ""
  try {
    const r = await fetch("http://127.0.0.1:" + PORT + "/plugins/mpd-workmate/init", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ base: "hephaestus", name: "gui-alice", note: "created from GUI" }),
      signal: AbortSignal.timeout(5000),
    })
    const body = await r.text()
    initOk = r.status === 200 && body.includes("gui-alice") && body.includes("Deep Worker")
    initNote = body.slice(0, 160)
  } catch (e) { initNote = String(e.message ?? e) }
  const alice = join(wmHome, ".mpd", "workmate", "gui-alice")
  const filesOk = ["meta.json", "persona.md", "memory.md", "note.md"].every((f) => existsSync(join(alice, f)))
  steps.initRoute = { ok: initOk, note: initNote, filesOk }
  steps.isolation = { ok: !existsSync(join(homedir(), ".mpd", "workmate")), realHome: join(homedir(), ".mpd", "workmate") }
  const allOk = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, dshHome: home, wmHome, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), readFileSync(log, "utf8").slice(0, 30000) + "\n--- client ids ---\n" + [...clientBody.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]).join(","))
  console.log("[web-client-adapt] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 260))
  web.kill("SIGTERM")
  try { await new Promise((r) => setTimeout(r, 1200)) } catch {}
  if (!allOk) process.exit(1)
  console.log("[web-client-adapt] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
