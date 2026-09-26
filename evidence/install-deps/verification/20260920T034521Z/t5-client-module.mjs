#!/usr/bin/env node
/*
 * t5 — the browser-half probe, corrected.
 *
 * Pass-2's first probe fetched the client URL as it appears in the index HTML, i.e. with the
 * entity `&amp;` still in it, and the server answered 404. That is a VERIFIER-side URL bug, not a
 * bundle defect: the module list is `&amp;`-escaped in the HTML. This script boots one sandbox
 * again, decodes the entity, and fetches BOTH forms:
 *   (1) the exact combined URL the HTML serves, entity-decoded;
 *   (2) the single-module form `/plugins/??dsh-better-sidebar/client.js&rev=<rev>`.
 *
 * Usage: node t5-client-module.mjs <sandbox-dir> [profileName] [port]   (T5_RUN_DIR = this directory)
 */
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const RUN_DIR = process.env.T5_RUN_DIR ? resolve(process.env.T5_RUN_DIR) : HERE
const SANDBOX = process.argv[2] ? resolve(RUN_DIR, process.argv[2]) : join(RUN_DIR, "sandboxes", "A1-bundle-only")
const PROFILE_NAME = process.argv[3] ?? "w"
const PORT = Number(process.argv[4] ?? 3590)
const TAG = PROFILE_NAME + "@" + SANDBOX.split("/").slice(-2).join("/")
const PROFILE = join(SANDBOX, "dsh", "profiles", PROFILE_NAME)
const SIDEBAR = "dsh-better-sidebar"
const BOOT_WAIT_MS = Number(process.env.T5_BOOT_MS ?? 90_000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const readText = (p) => { try { return readFileSync(p, "utf8") } catch { return "" } }
const utc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")

async function main() {
  if (!existsSync(join(PROFILE, "package.json"))) throw new Error("no profile at " + PROFILE)
  const env = { ...process.env, DSH_HOME: join(SANDBOX, "dsh"), HOME: join(SANDBOX, "home") }
  const logPath = join(SANDBOX, "boot-client-probe.log")
  const fd = openSync(logPath, "w")
  const child = spawn("dsh", ["--profile", PROFILE_NAME, "--port", String(PORT), "--no-open"], { env, cwd: join(SANDBOX, "ws"), stdio: ["ignore", fd, fd] })
  const base = "http://127.0.0.1:" + PORT
  const out = { id: "client-module-probe", tag: TAG, profile: PROFILE_NAME, atUtc: utc(), bootCommand: "dsh --profile " + PROFILE_NAME + " --port " + PORT + " --no-open", booted: false }
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
      } catch { /* starting */ }
    }
    out.booted = token !== null && cookie !== ""
    if (!out.booted) {
      out.reason = "no token+cookie within " + BOOT_WAIT_MS + "ms (see " + logPath + ")"
      out.checks = [{ name: "load.booted", ok: false, detail: out.reason }]
      out.ok = false
    } else {
    const html = await (await fetch(base + "/", { headers: { cookie }, signal: AbortSignal.timeout(15_000) })).text()
    const raw = [...new Set([...html.matchAll(/\/plugins\/[^\s"'<>\\]*client\.js[^\s"'<>\\]*/g)].map((m) => m[0]))]
    const decoded = raw.map((u) => u.replaceAll("&amp;", "&"))
    out.combinedUrlsRaw = raw.length
    const combined = decoded.find((u) => u.includes(SIDEBAR + "/client.js")) ?? null
    const rev = combined === null ? null : (/[?&]rev=([^&]+)/.exec(combined)?.[1] ?? null)
    const probes = []
    if (combined !== null) probes.push({ label: "html-combined-entity-decoded", url: combined })
    if (rev !== null) probes.push({ label: "single-module", url: "/plugins/??" + SIDEBAR + "/client.js&rev=" + rev })
    for (const probe of probes) {
      try {
        const res = await fetch(base + probe.url, { headers: { cookie }, signal: AbortSignal.timeout(20_000) })
        const body = await res.text()
        probe.status = res.status
        probe.bytes = Buffer.byteLength(body)
        probe.sha256 = createHash("sha256").update(body).digest("hex")
        probe.head = body.slice(0, 80).replaceAll("\n", " ")
        probe.carriesSidebarIdentity = body.includes(SIDEBAR) || body.includes("betterSidebar") || body.includes("sidebar")
      } catch (error) { probe.error = String(error?.message ?? error) }
    }
    out.probes = probes
    out.rev = rev
    out.checks = [
      { name: "htmListsSidebarModule", ok: raw.some((u) => u.includes(SIDEBAR + "/client.js")), detail: "urls=" + raw.length },
      { name: "combinedModule200", ok: probes[0]?.status === 200 && (probes[0]?.bytes ?? 0) > 1000, detail: JSON.stringify(probes[0] ?? null) },
      { name: "singleModule200", ok: probes[1]?.status === 200 && (probes[1]?.bytes ?? 0) > 1000, detail: JSON.stringify(probes[1] ?? null) },
    ]
    out.ok = out.checks.every((c) => c.ok)
    }
  } catch (error) {
    out.reason = "probe threw: " + String(error?.message ?? error)
  } finally {
    const lines = readText(logPath).split("\n")
    out.guard = (() => { for (const line of lines) { const m = /mount guard:\s*(ENABLED|DISABLED)\s*-\s*(.*)$/.exec(line); if (m) return { decision: m[1], reason: m[2].trim() } } return null })()
    try { child.kill("SIGTERM") } catch { /* gone */ }
    await sleep(2000)
    try { child.kill("SIGKILL") } catch { /* gone */ }
  }
  mkdirSync(join(RUN_DIR, "arms"), { recursive: true })
  writeFileSync(join(RUN_DIR, "arms", "client-module-probe.json"), JSON.stringify(out, null, 2) + "\n")
  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => { console.error("t5-client-module failed: " + String(error?.stack ?? error)); process.exit(1) })
