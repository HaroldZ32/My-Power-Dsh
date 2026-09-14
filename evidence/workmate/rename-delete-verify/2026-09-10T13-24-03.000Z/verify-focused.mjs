#!/usr/bin/env node
// t6 driver #2: boots a fresh dsh with probe2 mounted, then reports the tool-path defect and
// the deny-list A/B control. Writes result-focused.json + output-focused.log.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = "/root/dshProj/my-power-dsh"
const transcript = []
const checks = []
const log = (l) => { transcript.push(l); console.log(l) }
const check = (id, ok, detail) => { checks.push({ id, ok: Boolean(ok), detail: typeof detail === "string" ? detail : JSON.stringify(detail) }); log((ok ? "PASS " : "FAIL ") + id + " :: " + (typeof detail === "string" ? detail : JSON.stringify(detail))) }

const sandbox = mkdtempSync(join(tmpdir(), "mpd-t6-focus-"))
const dshHome = join(sandbox, "dsh-home"), userHome = join(sandbox, "user-home"), profile = join(dshHome, "profiles", "h")
const lib = join(userHome, ".mpd", "workmate")
mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
mkdirSync(join(dshHome, ".agent-presets"), { recursive: true })
mkdirSync(userHome, { recursive: true })
const realNM = join(homedir(), ".dsh", "profiles", "web", "node_modules")
for (const n of ["@deepseek-ai", "@linxin666", "dsh-better-sidebar"]) symlinkSync(join(realNM, n), join(profile, "node_modules", n))
symlinkSync(ROOT, join(profile, "node_modules", "@mpd-dsh", "mpd"))
if (existsSync(join(homedir(), ".dsh", ".credentials.yaml"))) cpSync(join(homedir(), ".dsh", ".credentials.yaml"), join(dshHome, ".credentials.yaml"))
writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-h", private: true, dependencies: { "@mpd-dsh/mpd": "link:" + ROOT }, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@mpd-dsh/mpd"] } } }, null, 2))
const overlay = join(sandbox, "probe2-overlay.yml")
writeFileSync(overlay, ["- insert:", "    - id: mpd-t6-probe2", "      name: '" + join(HERE, "probe2.mjs") + "'", ""].join("\n"))
const bootLog = join(sandbox, "boot.log")
const fd = openSync(bootLog, "w")
log("[t6-focus] sandbox=" + sandbox + " HOME=" + userHome)
const run = spawnSync("dsh", ["--profile", "h", "--patch", overlay, "noop"], { env: { ...process.env, DSH_HOME: dshHome, HOME: userHome }, cwd: ROOT, stdio: ["ignore", fd, fd], timeout: 300000 })
const bootText = existsSync(bootLog) ? readFileSync(bootLog, "utf8") : ""
writeFileSync(join(HERE, "focused-boot.log"), bootText)
log("[t6-focus] dsh exit=" + run.status)
const m = bootText.match(/\[t6-probe2\] RESULT=(\{.*\})/s)
check("probe2.executed", m !== null, m ? "RESULT found" : "no RESULT; tail: " + bootText.slice(-500))
let p = null
if (m) p = JSON.parse(m[1])
const s = (id) => (p?.steps ?? []).find((x) => x.id === id)

if (p) {
  // (a) The two NEW tools vs the harness output validation.
  const ren = s("rename.raw"), delA = s("delete.archive.raw"), delP = s("delete.purge.raw")
  const invalidOutput = (r) => r && r.ok === false && /returned invalid output/.test(String(r.error ?? ""))
  check("FINDING.rename-tool-output-rejected", invalidOutput(ren), ren)
  check("FINDING.delete-archive-tool-output-rejected", invalidOutput(delA), delA)
  check("FINDING.delete-purge-tool-output-rejected", invalidOutput(delP), delP)
  check("control.init-tool-accepted", s("init")?.ok === true, s("init"))
  check("control.reflect-tool-accepted", s("reflect.raw")?.ok === true, s("reflect.raw")?.value ?? s("reflect.raw")?.error)

  // The mutation still happens despite the rejected output — that is the hazard.
  check("hazard.rename-mutation-applied-despite-error", s("service.get.after-rename")?.name === "probe-b" && s("service.get.after-rename")?.oldKey === null, s("service.get.after-rename"))
  const archDir = join(lib, ".archive")
  const archEntries = existsSync(archDir) ? readdirSync(archDir) : []
  check("hazard.delete-archive-applied-despite-error", !existsSync(join(lib, "probe-b")) && archEntries.some((e) => e.startsWith("probe-b-")), { dir: existsSync(join(lib, "probe-b")), archive: archEntries })
  check("hazard.purge-applied-despite-error", !existsSync(join(lib, "probe-c")), { present: existsSync(join(lib, "probe-c")) })

  // (b) positives on the tool path.
  const g0 = s("service.get.after-init"), g1 = s("service.get.after-rename"), g2 = s("service.get.after-reflect")
  check("rename preserves uses (tool path)", g1?.uses === g0?.uses, { before: g0?.uses, after: g1?.uses })
  check("rename preserves createdAt (tool path)", g1?.createdAt === g0?.createdAt, { before: g0?.createdAt, after: g1?.createdAt })
  check("A4 renamedFrom survives reflect (tool path)", Array.isArray(g2?.renamedFrom) && g2.renamedFrom.includes("probe-a"), g2)
  check("service.get exposes rename history", Object.prototype.hasOwnProperty.call(g2 ?? {}, "renamedFrom"), { keys: g2 === undefined ? null : Object.keys(g2 ?? {}) })
  check("confirm-required refusal via tool", s("delete.confirm-missing.raw")?.ok === false && /confirm/i.test(String(s("delete.confirm-missing.raw")?.error ?? "")), s("delete.confirm-missing.raw")?.error)

  // (c) deny-list evidence.
  const A = s("deny.A.roles-real"), B = s("deny.B.roles-plus-dead-name"), C = s("deny.C.workmate-real"), D = s("deny.D.workmate-plus-dead-name")
  const deadErr = (r) => /unknown global tools/.test(String(r?.error ?? ""))
  // HONEST LIMIT: the four spawn attempts below never reached restrict() in this probe context
  // (no agent/parent context at boot: every call died in the adapter before composition), so this
  // A/B is INCONCLUSIVE — it must never be read as a pass. Recorded as such, not as evidence.
  const abInconclusive = !deadErr(A) && !deadErr(B) && !deadErr(C) && !deadErr(D) && /aborted/.test(String(A?.error ?? ""))
  check("deny.ab-inconclusive (recorded, never a pass)", abInconclusive, { A: A?.error, B: B?.error, C: C?.error, D: D?.error })
  check("deny.lists-are-identical-seven", JSON.stringify(s("deny.lists")?.roles) === JSON.stringify(s("deny.lists")?.workmate) && (s("deny.lists")?.roles ?? []).length === 7, s("deny.lists"))
  // Decisive credential-free property: every denied name IS live-registered, and both dead names
  // are NOT — the exact condition restrict() checks.
  const reg = s("deny.registry-inclusion")
  const liveAll = reg !== undefined && Object.values(reg.live ?? {}).every((v) => v === true)
  const deadAbsent = reg?.dead?.str_replace_editor === false && reg?.dead?.apply_patch === false
  check("deny.all-seven-names-are-live-registered", liveAll, reg?.live)
  check("deny.both-dead-names-are-unregistered", deadAbsent, reg?.dead)
  check("deny.read-tools-not-denied", reg?.read === true && reg?.glob === true && reg?.grep === true, { read: reg?.read, glob: reg?.glob, grep: reg?.grep })
}

const failed = checks.filter((c) => !c.ok)
const result = { ok: failed.length === 0, slug: "rename-delete-verify/focused", mode: "real-boot+probe2", sandbox, userHome, dshExit: run.status, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks, probeResult: p }
writeFileSync(join(HERE, "result-focused.json"), JSON.stringify(result, null, 2))
writeFileSync(join(HERE, "output-focused.log"), transcript.join("\n") + "\n")
log("[t6-focus] TOTAL " + checks.length + ", passed " + (checks.length - failed.length) + ", failed " + failed.length)
process.exit(0)
