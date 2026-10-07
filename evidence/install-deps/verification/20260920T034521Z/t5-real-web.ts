#!/usr/bin/env node
/*
 * t5 — END-TO-END arm: the EXACT shipped command, then a REAL boot of the profile it produced.
 *
 * `dsh plugin --profile web add <repo>` ran in this directory's `real-web/` sandbox (DSH_HOME,
 * HOME and cwd all inside it) and exited 0. This script does NOT rebuild that profile: it boots
 * the artifact the CLI actually wrote and probes it. It also records whether the harness's
 * module fallback materialized the bundle's declared `dependencies` into <profile>/node_modules
 * (the mechanism that makes the guarded row resolvable).
 *
 * Usage: node t5-real-web.mjs    (run AFTER the install; env T5_BOOT_MS)
 */
import { spawn, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, writeFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "../../../..")
const RUN_DIR = process.env.T5_RUN_DIR ? resolve(process.env.T5_RUN_DIR) : HERE
const SANDBOX = process.argv[2] ? resolve(RUN_DIR, process.argv[2]) : join(RUN_DIR, "real-web")
const PROFILE = join(SANDBOX, "dsh", "profiles", "web")
const WS = join(SANDBOX, "ws")
const SIDEBAR = "dsh-better-sidebar"
const ROUTE = "/sidebar/api"
const PORT = Number(process.env.T5_REAL_PORT ?? 3580)
const BOOT_WAIT_MS = Number(process.env.T5_BOOT_MS ?? 90_000)
const FATAL = ["plugin(s) failed to load", "did not activate", "pending (waiting for service", "failed to apply loader entry", "duplicate prefix route", "duplicate loader entry id", "plugin tree failed to load", "unsupported JSON schema"]
const utc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const readText = (p) => { try { return readFileSync(p, "utf8") } catch { return "" } }
const listDir = (p) => { try { return readdirSync(p).sort() } catch { return null } }

async function main() {
  if (!existsSync(join(PROFILE, "package.json"))) throw new Error("no installed profile at " + PROFILE + " — run the install first")
  const env = { ...process.env, DSH_HOME: join(SANDBOX, "dsh"), HOME: join(SANDBOX, "home") }
  const manifest = JSON.parse(readText(join(PROFILE, "package.json")))
  const before = {
    atUtc: utc(), profile: PROFILE,
    manifest, nodeModules: listDir(join(PROFILE, "node_modules")),
    sidebarResolvable: existsSync(join(PROFILE, "node_modules", SIDEBAR)),
    installLogTail: readText(join(SANDBOX, "plugin-add.log")).split("\n").filter(Boolean).slice(-4),
  }
  const logPath = join(SANDBOX, "boot.log")
  const fd = openSync(logPath, "w")
  const child = spawn("dsh", ["--profile", "web", "--port", String(PORT), "--no-open"], { env, cwd: WS, stdio: ["ignore", fd, fd] })
  const base = "http://127.0.0.1:" + PORT
  const load = { claim: "REAL boot of the profile the CLI actually wrote", bootCommand: "dsh --profile web --port " + PORT + " --no-open", logPath, port: PORT, booted: false }
  try {
    let token = null, cookie = ""
    const deadline = Date.now() + BOOT_WAIT_MS
    while (Date.now() < deadline) {
      await sleep(1500)
      const m = /token=([^\s&"'<>]+)/.exec(readText(logPath))
      if (m !== null) token = m[1]
      if (token === null) continue
      try {
        const auth = await fetch(base + "/?token=" + token, { redirect: "manual", signal: AbortSignal.timeout(8000) })
        cookie = (auth.headers.getSetCookie?.() ?? []).map((v) => v.split(";")[0]).join("; ")
        if (cookie !== "") break
      } catch { /* still starting */ }
    }
    load.booted = token !== null && cookie !== ""
    if (load.booted) {
      const html = await (await fetch(base + "/", { headers: { cookie }, signal: AbortSignal.timeout(15_000) })).text()
      load.servedClientCarriesSidebar = html.includes(SIDEBAR + "/client.js")
      const urls = [...new Set([...html.matchAll(/\/plugins\/[^\s"'<>\\]*client\.js[^\s"'<>\\]*/g)].map((m) => m[0]))]
      const url = urls.find((u) => u.includes(SIDEBAR + "/client.js"))
      if (url) { const mod = await fetch(base + url, { headers: { cookie }, signal: AbortSignal.timeout(15_000) }); load.sidebarClientModule = { url, status: mod.status, bytes: (await mod.text()).length } }
      const route = await fetch(base + ROUTE, { headers: { cookie }, signal: AbortSignal.timeout(15_000) })
      load.sidebarRoute = { status: route.status, body: (await route.text()).slice(0, 160) }
      load.sidebarRouteMounted = route.status !== 404
    } else {
      load.reason = "no token+cookie within " + BOOT_WAIT_MS + "ms"
    }
  } catch (error) {
    load.reason = "probe threw: " + String(error?.message ?? error)
  } finally {
    const lines = readText(logPath).split("\n")
    load.signatures = { hits: FATAL.filter((m) => lines.join("\n").includes(m)), healthy: FATAL.every((m) => !lines.join("\n").includes(m)) }
    load.guard = (() => { for (const line of lines) { const m = /mount guard:\s*(ENABLED|DISABLED)\s*-\s*(.*)$/.exec(line); if (m) return { decision: m[1], reason: m[2].trim() } } return null })()
    load.guardLines = lines.filter((l) => l.includes("mount guard"))
    load.logTail = lines.filter(Boolean).slice(-8)
    try { child.kill("SIGTERM") } catch { /* gone */ }
    await sleep(2000)
    try { child.kill("SIGKILL") } catch { /* gone */ }
  }
  const after = {
    atUtc: utc(),
    nodeModules: listDir(join(PROFILE, "node_modules")),
    sidebarResolvable: existsSync(join(PROFILE, "node_modules", SIDEBAR)),
    sidebarLinkTarget: (() => { try { return statSync(join(PROFILE, "node_modules", SIDEBAR)).isSymbolicLink() ? readlinkSync(join(PROFILE, "node_modules", SIDEBAR)) : "(real dir)" } catch { return null } })(),
    moduleFallback: listDir(join(PROFILE, ".dsh-module-fallback")),
  }
  const checks = [
    { name: "install.profile", ok: Array.isArray(manifest.dsh?.profile?.bundles) && manifest.dsh.profile.bundles.includes("@mpd-dsh/mpd"), detail: JSON.stringify(manifest.dsh?.profile?.bundles) },
    { name: "load.booted", ok: load.booted === true, detail: load.booted ? "booted" : String(load.reason) },
    { name: "load.noFatalSignature", ok: load.signatures.healthy === true, detail: JSON.stringify(load.signatures.hits) },
    { name: "load.guardEnabled", ok: load.guard?.decision === "ENABLED", detail: JSON.stringify(load.guard) },
    { name: "load.sidebarServed", ok: load.servedClientCarriesSidebar === true && load.sidebarRouteMounted === true, detail: "served=" + load.servedClientCarriesSidebar + " route=" + JSON.stringify(load.sidebarRoute) + " module=" + JSON.stringify(load.sidebarClientModule ?? null) },
    { name: "fallback.materialized", ok: after.sidebarResolvable === true, detail: JSON.stringify({ before: before.sidebarResolvable, after: after.sidebarResolvable, link: after.sidebarLinkTarget, fallback: after.moduleFallback }) },
  ]
  const out = { id: "E2E-real-web-profile", kind: "the EXACT shipped command + a REAL boot of its artifact", installCommand: "dsh plugin --profile web add " + REPO, before, load, after, checks, ok: checks.every((c) => c.ok) }
  const armsDir = process.env.T5_ARMS_DIR ? resolve(process.env.T5_ARMS_DIR) : join(RUN_DIR, "arms")
  mkdirSync(armsDir, { recursive: true })
  writeFileSync(join(armsDir, "E2E-real-web-profile.json"), JSON.stringify(out, null, 2) + "\n")
  console.log(JSON.stringify({ id: out.id, ok: out.ok, failed: checks.filter((c) => !c.ok).map((c) => c.name), guard: load.guard, route: load.sidebarRoute, served: load.servedClientCarriesSidebar, clientModule: load.sidebarClientModule ?? null, fallback: after.sidebarResolvable, signatures: load.signatures.hits }, null, 2))
}

main().catch((error) => { console.error("t5-real-web failed: " + String(error?.stack ?? error)); process.exit(1) })
