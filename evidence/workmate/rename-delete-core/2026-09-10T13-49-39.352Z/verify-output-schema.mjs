#!/usr/bin/env node
// t15 real-boot driver: boots a REAL fresh dsh process in a sandbox (isolated DSH_HOME + sandbox
// HOME) with probe.mjs mounted through `dsh --patch`, then asserts that the three mutation tool
// calls survive the harness OUTPUT VALIDATOR.
//
//   before the fix: rename / delete-archive / delete-purge each answer
//     `tool "mpd_workmate_rename" returned invalid output: "value.ok" is not a declared property
//      (additionalProperties: false)` — AFTER the mutation was applied.
//   after the fix:  all three answer ok with their values, and the library state agrees.
//
// Usage: node verify-output-schema.mjs <phase>      phase = before | after
// Exit is the DRIVER's (0 = the phase's expectation held), never dsh's.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = "/root/dshProj/my-power-dsh"
const PHASE = process.argv[2] === "before" ? "before" : "after"
const transcript = []
const checks = []
const log = (line) => { transcript.push(line); console.log(line) }
const check = (id, ok, detail) => {
  checks.push({ id, ok: Boolean(ok), detail: typeof detail === "string" ? detail : JSON.stringify(detail) })
  log((ok ? "PASS " : "FAIL ") + id + " :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)))
  return Boolean(ok)
}
const dirHash = (dir) => {
  if (!existsSync(dir)) return null
  const files = []
  const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else files.push(p) } }
  walk(dir)
  const h = createHash("sha256")
  for (const f of files.map((f) => f.slice(dir.length + 1)).sort()) h.update(f + "\n" + createHash("sha256").update(readFileSync(join(dir, f))).digest("hex") + "\n")
  return { files: files.length, sha: h.digest("hex") }
}

const sandbox = mkdtempSync(join(tmpdir(), "mpd-t15-"))
const dshHome = join(sandbox, "dsh-home")
const userHome = join(sandbox, "user-home")
const store = join(dshHome, "store")
const lib = join(userHome, ".mpd", "workmate")
const realLib = join(homedir(), ".mpd", "workmate")
const realLibBefore = dirHash(realLib)
mkdirSync(userHome, { recursive: true })
mkdirSync(store, { recursive: true })

log("=== t15 output-schema " + PHASE + "-fix real-boot verification ===")
log("repo=" + ROOT + "  HEAD=" + spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim())
log("sandbox=" + sandbox + "  DSH_HOME=" + dshHome + "  HOME=" + userHome)
log("phase=" + PHASE + "  (before = the schema defect is expected; after = it must be gone)")

const realDsh = join(homedir(), ".dsh")
for (const f of [".credentials.yaml", "settings.yaml"]) {
  if (existsSync(join(realDsh, f))) { cpSync(join(realDsh, f), join(dshHome, f)); log("[setup] copied " + f + " into the sandbox") }
}

// ── install the bundle into the sandbox profile (a real profile, not a hand-made one) ───────────
const install = spawnSync("dsh", ["plugin", "--profile", "h", "add", "--store-dir", store, ROOT], {
  env: { ...process.env, HOME: userHome, DSH_HOME: dshHome }, cwd: ROOT, encoding: "utf8", timeout: 900000,
})
log("[install] exit=" + install.status + " :: " + String(install.stderr ?? "").trim().split("\n").slice(-1)[0])
if (install.status !== 0) { log(JSON.stringify({ phase: PHASE, checks, transcript }, null, 2).slice(0, 4000)) ; writeFileSync(join(HERE, "verify-" + PHASE + ".json"), JSON.stringify({ phase: PHASE, checks, transcript }, null, 2)); process.exit(1) }

const overlay = join(sandbox, "probe-overlay.yml")
writeFileSync(overlay, [
  "# t15 QA overlay: mounts the boot-time probe that drives the mutation tools through the real harness.",
  "- insert:",
  "    - id: mpd-t15-probe",
  "      name: '" + join(HERE, "probe.mjs") + "'",
  "",
].join("\n"))

const bootLog = join(sandbox, "t15-boot.log")
const fd = openSync(bootLog, "w")
const boot = spawnSync("dsh", ["--profile", "h", "--patch", overlay, "noop"], {
  env: { ...process.env, DSH_HOME: dshHome, HOME: userHome },
  cwd: ROOT, stdio: ["ignore", fd, fd], timeout: 300000,
})
const bootText = existsSync(bootLog) ? readFileSync(bootLog, "utf8") : ""
writeFileSync(join(HERE, "boot-" + PHASE + ".log"), bootText)
log("[boot] dsh exit=" + boot.status + " (killed at the cap is normal)")

const match = bootText.match(/\[t15-probe\] RESULT=(\{.*\})/s)
check("probe.executed-in-fresh-process", match !== null, match ? "RESULT line found" : "no RESULT line; log tail: " + bootText.slice(-500))
let probe = null
if (match) { try { probe = JSON.parse(match[1]) } catch (e) { check("probe.result-parseable", false, String(e)) } }
const stepOf = (id) => (probe?.steps ?? []).find((s) => s.id === id)

if (probe) {
  const reg = stepOf("probe.tools-registered")
  check("tools.rename+delete registered", reg?.ready === true && reg?.hasRename === true && reg?.hasDelete === true, reg)
  check("fixture init (sandbox HOME)", stepOf("tool.init")?.ok === true, stepOf("tool.init")?.error ?? stepOf("tool.init")?.value)

  const rename = stepOf("tool.rename") ?? {}
  const archive = stepOf("tool.delete.archive") ?? {}
  const purge = stepOf("tool.delete.purge") ?? {}
  const invalid = (r) => typeof r.error === "string" && r.error.includes("returned invalid output")

  if (PHASE === "before") {
    // The defect: every successful mutation is reported as a FAILURE by the harness validator.
    const renameRejected = invalid(rename)
    check("DEFECT: rename reported invalid output after applying", renameRejected, rename.error ?? rename.value)
    check("DEFECT: archive delete reported invalid output after applying", invalid(archive), archive.error ?? archive.value)
    check("DEFECT: purge delete reported invalid output after applying", invalid(purge), purge.error ?? purge.value)
    check("DEFECT: the mutation landed anyway (old key freed)", stepOf("state.after-rename")?.oldKey === null, stepOf("state.after-rename"))
    check("DEFECT: the retry answers without the mutation being re-applied (collision/unknown)",
      stepOf("tool.rename.retry-after-reported-failure")?.ok === true || /no workmate named/.test(String(stepOf("tool.rename.retry-after-reported-failure")?.error ?? "")),
      stepOf("tool.rename.retry-after-reported-failure")?.error ?? stepOf("tool.rename.retry-after-reported-failure")?.value)
    check("DEFECT: archive + purge landed anyway (both keys gone from the library)",
      stepOf("state.after-archive")?.get === null && stepOf("state.after-purge")?.get === null,
      { archive: stepOf("state.after-archive"), purge: stepOf("state.after-purge") })
  } else {
    check("rename: NO invalid-output error", rename.ok === true && !invalid(rename), rename.error ?? rename.value)
    check("delete archive: NO invalid-output error", archive.ok === true && !invalid(archive), archive.error ?? archive.value)
    check("delete purge: NO invalid-output error", purge.ok === true && !invalid(purge), purge.error ?? purge.value)
    check("rename value agrees with the schema (ok, name, from)", rename.value?.ok === true && rename.value?.name === "t15-probe-2" && rename.value?.from === "t15-probe", rename.value)
    check("archive value agrees with the schema (ok, name, archived, purged)", archive.value?.ok === true && archive.value?.name === stepOf("state.live-key")?.liveKey && typeof archive.value?.archived === "string" && archive.value?.purged === false, archive.value)
    check("purge value agrees with the schema (ok, name, archived:null, purged)", purge.value?.ok === true && purge.value?.name === "t15-purge" && purge.value?.archived === null && purge.value?.purged === true, purge.value)
    check("report and mutation AGREE: old key freed", stepOf("state.after-rename")?.oldKey === null && stepOf("state.after-rename")?.newKeyExists === true, stepOf("state.after-rename"))
    check("report and mutation AGREE: archived instance is out of the library", stepOf("state.after-archive")?.get === null && stepOf("state.after-archive")?.listContains === false, stepOf("state.after-archive"))
    check("report and mutation AGREE: purged instance is out of the library", stepOf("state.after-purge")?.get === null && stepOf("state.after-purge")?.listContains === false, stepOf("state.after-purge"))
    // The whole point of the repair: the FIRST call reported success, so the caller has the new name
    // and has no reason to retry. The blind retry the pre-fix agent was forced into (same old name
    // again) is now an honest 404-equivalent error instead of a silent second mutation.
    const retryAfter = stepOf("tool.rename.retry-after-reported-failure") ?? {}
    check("a blind retry is now an explicit error (no silent double mutation)",
      retryAfter.ok === false && /no workmate named/.test(String(retryAfter.error ?? "")), retryAfter.error ?? retryAfter.value)
    // Filesystem truth: the archive really holds the archived instance; nothing was left behind.
    const archiveDir = join(lib, ".archive")
    const archivedNames = existsSync(archiveDir) ? readdirSync(archiveDir) : []
    check("filesystem: the archived instance is under .archive/", archivedNames.some((n) => n.startsWith(String(stepOf("state.live-key")?.liveKey ?? "t15-probe") + "-")), archivedNames)
    check("filesystem: the purged instance left no bytes (not in the library, not in .archive/)",
      !existsSync(join(lib, "t15-purge")) && !archivedNames.some((n) => n.startsWith("t15-purge-")), { archivedNames, libEntries: existsSync(lib) ? readdirSync(lib) : [] })
  }

  // Isolation holds in both phases.
  check("real ~/.mpd/workmate untouched", JSON.stringify(realLibBefore) === JSON.stringify(dirHash(realLib)), dirHash(realLib))
}

const result = { task: "t15", phase: PHASE, sandbox, head: spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(), passed: checks.every((c) => c.ok), checks, transcript }
writeFileSync(join(HERE, "verify-" + PHASE + ".json"), JSON.stringify(result, null, 2))
log("=== " + PHASE + ": " + (result.passed ? "PASS" : "FAIL") + " (" + checks.filter((c) => c.ok).length + "/" + checks.length + " checks) ===")
process.exit(result.passed ? 0 : 1)
