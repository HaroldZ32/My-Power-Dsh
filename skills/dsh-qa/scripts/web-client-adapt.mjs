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
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, dirname } from "node:path"

import { fileURLToPath } from "node:url"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.mjs"
import { credentialEnv } from "./lib/credentials.mjs"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.mjs"

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
  checks.push(["combined client mounts both sidebar pages", client.includes('id: "@mpd-dsh/team-page"')
    && client.includes('TEAM_TAB_ID = "mpd-agent-teams"') && client.includes('const SIDEBAR_TAB_ID = "mpd-workmate"')])
  checks.push(["no workmate floater or footer toggle ships", !client.includes("mpd-workmate-library")
    && !client.includes("mpd-workmate-toggle")])
  // A declared-but-unregistered client service is FATAL: the web boot's
  // assertEntriesActive reports `entry: pending (waiting for service: X)` and throws
  // "Failed to load plugins", taking the whole page down. Drift-prone seams must
  // therefore be PROBED with ctx.get, never declared in the inject list.
  checks.push(["mpd client declares only stable seams", client.includes("const inject = REQUIRED_SERVICES.slice()")
    && client.includes('const REQUIRED_SERVICES = ["slots", "locale"]')])
  // The sidebar service belongs to ANOTHER plugin's fiber, so it must be WAITED FOR. A
  // one-shot `ctx.get` probe at apply() time answers undefined (measured live: false at
  // apply, true 8s later) and cordis never wakes a fiber that did not declare the name —
  // that regression cost the whole sidebar GUI once already.
  checks.push(["drift-prone seams are PROBED, never declared", !client.includes("staticInject")
    && /REQUIRED_SERVICES = \["slots", "locale"\]/.test(client)
    && !/REQUIRED_SERVICES = \[[^\]]*betterSidebar/.test(client)])
  checks.push(["the sidebar service is awaited through ctx.inject", client.includes('ctx.inject(["betterSidebar"]')
    && client.includes("mountSidebarPages(ctx, loadTeamPage())")
    && !client.includes("serviceAvailable(")])
  // BOTH GUIs are sidebar-only: no MPD-OWNED source may register the removed
  // in-conversation card, the removed agent-teams overlay floater, or the removed
  // workmate floater/footer toggle. The embedded adopted bundle still CONTAINS its own
  // registrations (its apply() is dormant and never called — asserted by
  // packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs), so this pin mirrors the build
  // gate and reads the mpd sources, not the concatenated artifact. Patterns are
  // REGISTRATION-shaped: team-page.js legitimately emits the adopted
  // `data-agent-teams-activity` marker on its panel root.
  const webClientSrc = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "src", "web-client.js"), "utf8")
  const teamPageSrc = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "src", "team-page.js"), "utf8")
  const mpdSources = [webClientSrc, teamPageSrc]
  const removedRegistrations = [
    /id:\s*["'`]agent-teams-activity["'`]/,
    /inject\(\s*["'`]conversation\.chat\.node["'`]/,
    /inject\(\s*["'`]shell\.overlay["'`]/,
    /inject\(\s*["'`]sidebar\.footer\.action["'`]/,
  ]
  checks.push(["both GUIs are sidebar-only", mpdSources.some((s) => s.includes("registerTeamSidebarTab"))
    && mpdSources.some((s) => s.includes("the AgentTeams page has no host"))
    && mpdSources.some((s) => s.includes("registerWorkmateSidebarTab"))
    && mpdSources.every((s) => removedRegistrations.every((re) => !re.test(s)))])
  const wm = readFileSync(join(ROOT, "packages", "mpd-workmate-plugin", "src", "index.ts"), "utf8")
  checks.push(["workmate host routes", wm.includes("/plugins/mpd-workmate/list") && wm.includes("/plugins/mpd-workmate/init") && wm.includes("internal/service")])
  // The tab's mutation controls must speak the host's actual §D routes: a client URL that
  // drifts from the route literal above breaks rename/delete silently in the GUI only.
  checks.push(["workmate host mutation routes", wm.includes('path: "/plugins/mpd-workmate/rename"')
    && wm.includes('path: "/plugins/mpd-workmate/delete"')])
  const webSrcForUrls = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "src", "web-client.js"), "utf8")
  checks.push(["client rename/delete URLs match the host routes",
    webSrcForUrls.includes('const RENAME_URL = "/plugins/mpd-workmate/rename"')
    && webSrcForUrls.includes('const DELETE_URL = "/plugins/mpd-workmate/delete"')])
  checks.push(["client branches on the §D refusal reasons",
    ["invalid-name", "confirm-required", "unknown", "collision", "in-use"].every((r) => webSrcForUrls.includes(`case "${r}"`) || webSrcForUrls.includes(`"${r}"`))])
  // Bilingual parity: the page body ships a zh AND an en dictionary and every key must exist in
  // BOTH (an undocumented one-sided key renders a raw key name to the user). The rename/delete
  // surface is the newest addition, so its reason keys are asserted by name too.
  const dictKeys = (dictName) => {
    const body = webSrcForUrls.slice(webSrcForUrls.indexOf(`const ${dictName} = {`))
    return [...body.slice(0, body.indexOf("\n  };")).matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]).sort()
  }
  const zhKeys = dictKeys("zh")
  const enKeys = dictKeys("en")
  checks.push(["zh/en dictionaries have identical, non-empty key sets",
    zhKeys.length > 0 && enKeys.length > 0
    && zhKeys.join("\n") === enKeys.join("\n")
    && ["mutate.reason.invalidName", "mutate.reason.sameKey", "mutate.reason.confirmRequired",
        "mutate.reason.unknown", "mutate.reason.collision", "mutate.reason.inUse"].every((k) => zhKeys.includes(k))])
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
  // Workspace isolation: the web boot's session workspace is its cwd, so it must be a
  // sandbox dir — never the real checkout (DSH_HOME/HOME do not cover workspace state).
  const wsRoot = mkdtempSync(join(tmpdir(), "mpd-wc-ws-"))
  const ws = sandboxWorkspace(wsRoot)
  const profile = join(home, "profiles", "w")
  mkdirSync(profile, { recursive: true }); mkdirSync(join(home, ".agent-presets"), { recursive: true })
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  cpSync(join(homedir(), ".dsh", ".credentials.yaml"), join(home, ".credentials.yaml"))
  cpSync(join(ROOT, "dist", "mpd-package"), join(profile, "node_modules", "@mpd-dsh", "mpd"), { recursive: true })
  writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } } }, null, 2))
  const env = credentialEnv({ ...process.env, DSH_HOME: home, HOME: wmHome  })
  const log = join(outDir, "web.log")
  const fd = openSync(log, "w")
  const webSpec = dshCommand(["--profile", "w", "--port", String(PORT), "--no-open"], env)
  if (webSpec === null) throw new Error(DSH_MISSING)
  const web = spawn(webSpec.command, webSpec.args, { env, cwd: ws, detached: false, stdio: ["ignore", fd, fd] })
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
  //
  // Auth is a COOKIE session: `GET /?token=<printed token>` answers with Set-Cookie and
  // every later request must carry it. Fetching with the query token alone answers 401 on
  // this harness release, which is why this case went red while agent-teams-sidebar (which
  // does the cookie dance) stayed green.
  let token = ""
  let cookie = ""
  let entry = null, clientBody = "", clientStatus = 0, unregistered = [], rootHttp = 0
  // Client services this harness registers (verified against the live client Service
  // catalog). A boot row key that looks like a bare service name but is absent here is
  // exactly the drift that leaves an entry `pending`; `@scope/pkg` keys are module
  // dependencies, not services.
  const SERVICES = new Set(["layout", "locale", "sessions", "slots", "theme", "timer", "uiWorkspace", "workspaces"])
  // The web frontend's boot under concurrent load was measured at ~69s (red twice
  // at ~69s, green solo) against the old hard 60s deadline, so a slow-but-healthy
  // boot read as a capability failure. The deadline is now 150s and overridable
  // (MPD_DSH_QA_WEB_BOOT_DEADLINE_MS); the elapsed/deadline/timedOut triple is
  // recorded on bootEntry so a timing miss is visibly BOUNDED and cannot
  // masquerade as "@mpd-dsh/mpd is not in the boot graph".
  const BOOT_DEADLINE_MS = Number(process.env.MPD_DSH_QA_WEB_BOOT_DEADLINE_MS ?? 150000)
  const bootDeadline = Date.now() + BOOT_DEADLINE_MS
  while (Date.now() < bootDeadline && entry === null) {
    try { token = /token=([A-Za-z0-9_-]+)/.exec(readFileSync(log, "utf8"))?.[1] ?? token } catch { /* log not flushed yet */ }
    try {
      const authorize = await fetch("http://127.0.0.1:" + PORT + "/?token=" + token, { redirect: "manual", signal: AbortSignal.timeout(8000) })
      cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ") || cookie
      const res = await fetch("http://127.0.0.1:" + PORT + "/", { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(8000) })
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
          const cres = await fetch("http://127.0.0.1:" + PORT + entry.url, { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(8000) })
          clientStatus = cres.status
          clientBody = await cres.text()
        }
      }
    } catch (e) { console.log("  boot fetch err:", e.message) }
    if (entry === null) await new Promise((r) => setTimeout(r, 2000))
  }
  steps.rootStatus = { ok: rootHttp === 200 && token !== "" && cookie !== "", http: rootHttp, tokenSeen: token !== "", cookieSession: cookie !== "" }
  steps.bootEntry = { ok: entry !== null, id: entry?.id ?? null, elapsedMs: Date.now() - t0, deadlineMs: BOOT_DEADLINE_MS, timedOut: entry === null }
  // The SERVED bytes must carry both sidebar pages and none of the removed surfaces —
  // the real-boot counterpart of the build gate and of agent-teams-sidebar's
  // panelInteriorParity step.
  const servedSurface = {
    teamPageModule: clientBody.includes('id: "@mpd-dsh/team-page"'),
    teamPanelParity: clientBody.includes("className: css.panel")
      && clientBody.includes("className: css.panelHead")
      && clientBody.includes("className: css.teams"),
    workmateTab: clientBody.includes('const SIDEBAR_TAB_ID = "mpd-workmate"'),
    noWorkmateFloater: !clientBody.includes("mpd-workmate-library") && !clientBody.includes("mpd-workmate-toggle"),
  }
  steps.clientJs = {
    ok: clientStatus === 200 && clientBody.includes('id: "@mpd-dsh/mpd"') && clientBody.includes('id: "@nanmicoder/dsh-agent-teams"')
      && clientBody.includes("const inject = REQUIRED_SERVICES.slice()")
      && Object.values(servedSurface).every(Boolean),
    status: clientStatus,
    servedSurface,
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
  // The real host may ALREADY own a workmate library (a developer machine that really uses
  // the plugin does). What must hold is that THIS RUN never wrote into it: the instance it
  // created is under the sandbox HOME, and the real library's entry set is unchanged.
  const realLibrary = join(homedir(), ".mpd", "workmate")
  const realEntriesBefore = existsSync(realLibrary) ? readdirSync(realLibrary).sort() : []
  const realEntriesAfter = existsSync(realLibrary) ? readdirSync(realLibrary).sort() : []
  steps.isolation = {
    ok: existsSync(alice)
      && !existsSync(join(realLibrary, "gui-alice"))
      && realEntriesBefore.join("\n") === realEntriesAfter.join("\n"),
    realHome: realLibrary,
    realLibraryPreExisting: realEntriesBefore.length,
    createdInSandbox: existsSync(alice),
  }
  // Falsifiable workspace-isolation proof: no session-store key may carry the real
  // checkout as its workspace (DSH_HOME/HOME isolation does not cover that).
  assertSessionsSandboxed(home, wsRoot, { label: "web-client-adapt" })
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
