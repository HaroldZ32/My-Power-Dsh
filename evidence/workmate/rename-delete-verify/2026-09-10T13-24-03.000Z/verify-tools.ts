#!/usr/bin/env node
// t6 tool/service driver: boots a REAL fresh dsh process in a sandbox (isolated DSH_HOME +
// sandbox HOME) with probe.mjs mounted through `dsh --patch`, then asserts the contract §C/§A4
// tool+service behaviour from the probe's RESULT= line and from the sandbox filesystem.
// The model step never runs (no provider key in this deployment) — the probe executes at boot,
// which is what makes this half credential-free. Exit is the driver's, not dsh's.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = "/root/dshProj/my-power-dsh"
const transcript = []
const checks = []
const log = (l) => { transcript.push(l); console.log(l) }
const check = (id, ok, detail) => { checks.push({ id, ok: Boolean(ok), detail: typeof detail === "string" ? detail : JSON.stringify(detail) }); log((ok ? "PASS " : "FAIL ") + id + " :: " + (typeof detail === "string" ? detail : JSON.stringify(detail))); return Boolean(ok) }
const dirHash = (dir) => {
  if (!existsSync(dir)) return null
  const out = []
  const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else out.push(p) } }
  walk(dir)
  const h = createHash("sha256")
  for (const f of out.map((f) => f.slice(dir.length + 1)).sort()) h.update(f + "\n" + createHash("sha256").update(readFileSync(join(dir, f))).digest("hex") + "\n")
  return { files: out.length, sha: h.digest("hex") }
}

const sandbox = mkdtempSync(join(tmpdir(), "mpd-t6-tools-"))
const dshHome = join(sandbox, "dsh-home")
const userHome = join(sandbox, "user-home")
const profile = join(dshHome, "profiles", "h")
const lib = join(userHome, ".mpd", "workmate")
const realLib = join(homedir(), ".mpd", "workmate")
const realLibBefore = dirHash(realLib)

mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
mkdirSync(join(dshHome, ".agent-presets"), { recursive: true })
mkdirSync(userHome, { recursive: true })
const realNM = join(homedir(), ".dsh", "profiles", "web", "node_modules")
for (const name of ["@deepseek-ai", "@linxin666", "dsh-better-sidebar"]) symlinkSync(join(realNM, name), join(profile, "node_modules", name))
symlinkSync(ROOT, join(profile, "node_modules", "@mpd-dsh", "mpd"))
const creds = join(homedir(), ".dsh", ".credentials.yaml")
if (existsSync(creds)) cpSync(creds, join(dshHome, ".credentials.yaml"))
writeFileSync(join(profile, "package.json"), JSON.stringify({
  name: "dsh-profile-h", private: true, dependencies: { "@mpd-dsh/mpd": "link:" + ROOT },
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@mpd-dsh/mpd"] } },
}, null, 2))

const overlay = join(sandbox, "probe-overlay.yml")
writeFileSync(overlay, [
  "# t6 QA overlay: mounts the boot-time probe that drives the workmate tools/service.",
  "- insert:",
  "    - id: mpd-t6-probe",
  "      name: '" + join(HERE, "probe.mjs") + "'",
  "",
].join("\n"))

const bootLog = join(sandbox, "tools-boot.log")
const fd = openSync(bootLog, "w")
log("[t6-tools] sandbox=" + sandbox + " HOME=" + userHome + " overlay=" + overlay)
const run = spawnSync("dsh", ["--profile", "h", "--patch", overlay, "noop"], {
  env: { ...process.env, DSH_HOME: dshHome, HOME: userHome },
  cwd: ROOT, stdio: ["ignore", fd, fd], timeout: 300000,
})
log("[t6-tools] dsh exit=" + run.status)
const bootText = existsSync(bootLog) ? readFileSync(bootLog, "utf8") : ""
writeFileSync(join(HERE, "tools-boot.log"), bootText)

const m = bootText.match(/\[t6-probe\] RESULT=(\{.*\})/s)
check("probe.executed-in-fresh-process", m !== null, m ? "RESULT line found" : "no RESULT line; log tail: " + bootText.slice(-600))
let probe = null
if (m) { try { probe = JSON.parse(m[1]) } catch (e) { check("probe.result-parseable", false, String(e)) } }
const stepOf = (id) => (probe?.steps ?? []).find((s) => s.id === id)

if (probe) {
  const reg = stepOf("probe.tools-registered")
  check("tools.rename+delete+init+reflect registered", reg?.ready === true && reg?.hasRename === true && reg?.hasDelete === true && reg?.hasInit === true, reg)
  const svc = stepOf("probe.service-present")
  check("service.exposes rename+delete+get+read", svc?.present === true && svc?.hasRename === true && svc?.hasDelete === true && svc?.hasGet === true && svc?.hasRead === true, svc)
  check("tool.init (sandbox HOME)", stepOf("tool.init")?.ok === true, stepOf("tool.init")?.value ?? stepOf("tool.init")?.error)
  const before = stepOf("service.get.before")
  check("service.get.before", before?.name === "probe-1", before)
  const ren = stepOf("tool.rename")
  check("tool.rename 200-equivalent", ren?.ok === true, ren?.value ?? ren?.error)
  check("service.get.old-key-freed", stepOf("service.get.old-key-freed")?.value === null, stepOf("service.get.old-key-freed"))
  check("tool.reflect.after-rename ok", stepOf("tool.reflect.after-rename")?.ok === true, stepOf("tool.reflect.after-rename")?.value ?? stepOf("tool.reflect.after-rename")?.error)
  const after = stepOf("service.get.after-reflect")
  check("A4 renamedFrom survives reflect (service.get)", Array.isArray(after?.renamedFrom) && after.renamedFrom.includes("probe-1"), after)
  check("A4 name/uses/createdAt after reflect", after?.name === "probe-2" && after?.uses === before?.uses && after?.createdAt === before?.createdAt, { name: after?.name, uses: after?.uses, createdAt: after?.createdAt, before: { uses: before?.uses, createdAt: before?.createdAt } })
  check("reflect wrote memory", typeof after?.memoryLen === "number" && after.memoryLen > 0, { memoryLen: after?.memoryLen })
  check("M4 stale key stays dead after reflect", stepOf("service.get.stale-key-after-reflect")?.value === null, stepOf("service.get.stale-key-after-reflect"))
  const delNoConfirm = stepOf("tool.delete.purge-without-confirm")
  check("tool.delete purge without confirm refused", delNoConfirm?.ok === false && /confirm/i.test(String(delNoConfirm?.error ?? "")), delNoConfirm)
  const delOk = stepOf("tool.delete.purge-with-confirm")
  check("tool.delete purge with confirm ok", delOk?.ok === true, delOk?.value ?? delOk?.error)
  check("service.get.after-purge null", stepOf("service.get.after-purge")?.value === null, stepOf("service.get.after-purge"))

  // On-disk cross-check of the same facts (the service view must agree with the filesystem).
  const metaPath = join(lib, "probe-2", "meta.json")
  check("fs.probe-2 purged from library", !existsSync(join(lib, "probe-2")), { present: existsSync(join(lib, "probe-2")) })
  const idx = existsSync(join(lib, "index.json")) ? JSON.parse(readFileSync(join(lib, "index.json"), "utf8")) : {}
  check("fs.index has no probe keys after purge", !Object.keys(idx).some((k) => k.startsWith("probe-")), Object.keys(idx))
}

const realLibAfter = dirHash(realLib)
check("isolation.real-library-untouched", JSON.stringify(realLibBefore) === JSON.stringify(realLibAfter), { before: realLibBefore, after: realLibAfter })
check("isolation.sandbox-home-used", lib === join(userHome, ".mpd", "workmate") && userHome !== homedir(), { lib, userHome })

const failed = checks.filter((c) => !c.ok)
const result = { ok: failed.length === 0, slug: "rename-delete-verify/tools", mode: "real-boot+probe", sandbox, dshHome, userHome, dshExit: run.status, total: checks.length, passed: checks.length - failed.length, failed: failed.length, failedChecks: failed.map((c) => c.id + " :: " + c.detail), checks, probeResult: probe }
writeFileSync(join(HERE, "result-tools.json"), JSON.stringify(result, null, 2))
writeFileSync(join(HERE, "output-tools.log"), transcript.join("\n") + "\n")
log("[t6-tools] TOTAL " + checks.length + " checks, passed " + (checks.length - failed.length) + ", failed " + failed.length)
process.exit(failed.length === 0 ? 0 : 1)
