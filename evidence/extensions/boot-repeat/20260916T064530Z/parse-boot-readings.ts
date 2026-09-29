#!/usr/bin/env node
// t24 — parse the repeat-boot logs into per-boot raw readings and the frequency fraction.
//
// OWNED BY THIS TASK. Reads only the logs this task's driver wrote (logs/boot-<i>.log) and
// emits result.json in this task's own evidence dir. It invents nothing: every field it
// reports is a line it copied out of a boot log.
//
// Usage: node parse-boot-readings.mjs [--runs N] [--json-out <path>]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const PREFIX = "[t24-parse]"

const argv = process.argv.slice(2)
const runsIdx = argv.indexOf("--runs")
const runs = runsIdx >= 0 ? Number(argv[runsIdx + 1]) : 6
const outIdx = argv.indexOf("--json-out")
const outPath = outIdx >= 0 ? resolve(argv[outIdx + 1]) : join(scriptDir, "result.json")

const EXT_ROW = "[mpd-ext] mpdExtensions provided"
const ROLES_ROW = "[mpd-roles] mpdRoles provided"
const IDENTITY = "adapterIdentity="
const FALLBACK = "ADAPTER FALLBACK"

const readings = []
for (let i = 1; i <= runs; i += 1) {
  const file = join(scriptDir, "logs", `boot-${i}.log`)
  if (!existsSync(file)) { readings.push({ run: i, log: file, valid: false, why: "log missing" }); continue }
  const text = readFileSync(file, "utf8")
  const lines = text.split(/\r?\n/)
  const extLine = lines.find((l) => l.includes(EXT_ROW)) ?? null
  const rolesLine = lines.find((l) => l.includes(ROLES_ROW)) ?? null
  const adapterLine = lines.find((l) => l.includes("[mpd-dsh-adapter] mpdDsh provided")) ?? null
  const lineNo = (l) => (l === null ? null : lines.indexOf(l) + 1)
  const identityLines = lines.filter((l) => l.includes(IDENTITY))
  const fallbackLines = lines.filter((l) => l.includes(FALLBACK))
  const extIdentity = extLine ? (/(adapterIdentity=[^\s|]+)/.exec(extLine) ?? [])[1] ?? null : null
  const rolesIdentity = rolesLine ? (/(adapterIdentity=[^\s|]+)/.exec(rolesLine) ?? [])[1] ?? null : null
  const valid = Boolean(extLine && rolesLine)
  const adapterLineIndex = lineNo(adapterLine)
  const extLineIndex = lineNo(extLine)
  readings.push({
    run: i,
    log: `logs/boot-${i}.log`,
    valid,
    why: valid ? "both rows printed their summary line, so both rows applied" : "a row summary line is missing - the boot did not reach the apply stage (NOT counted as a clean reading)",
    adapterLine, adapterLineIndex,
    extRow: extLine, extLineIndex,
    rolesRow: rolesLine, rolesLineIndex: lineNo(rolesLine),
    adapterProvidedBeforeExtApplied: adapterLineIndex !== null && extLineIndex !== null && adapterLineIndex < extLineIndex,
    extIdentity, rolesIdentity,
    identityLines,
    identityLineCount: identityLines.length,
    fallbackLines,
    fallbackCount: fallbackLines.length,
    fallbackFired: fallbackLines.length > 0 || extIdentity === "adapterIdentity=fallback:createDshAdapter" || rolesIdentity === "adapterIdentity=fallback:createDshAdapter"
  })
}

const valid = readings.filter((r) => r.valid)
const fallbackBoots = valid.filter((r) => r.fallbackFired)
const cleanBoots = valid.filter((r) => !r.fallbackFired)

const report = {
  task: "t24",
  driver: "repeat-boot.sh (this task's own) + parse-boot-readings.mjs",
  question: "On a CORRECTLY ORDERED tree, is the adapter fallback branch reachable?",
  howEachBootRan: "Each run copies a FRESHLY INSTALLED but never-booted pristine sandbox (byte copy, same directory depth so the profile's relative bundle symlink resolves), gets a fresh empty workspace cwd, and boots `dsh --profile rp \"say ok\"` with its own sandboxed DSH_HOME + HOME. The driver waits for BOTH rows' summary lines (a fallback warning is always emitted before its row's summary) and then stops the boot.",
  runsRequested: runs,
  validBoots: valid.length,
  invalidBoots: readings.filter((r) => !r.valid).map((r) => ({ run: r.run, why: r.why })),
  fallbackBoots: fallbackBoots.length,
  cleanBoots: cleanBoots.length,
  frequency: valid.length > 0 ? `${fallbackBoots.length}/${valid.length} boots took the fallback branch` : "no valid boots",
  readings
}

const out = outIdx >= 0 ? outPath : outPath
mkdirSync(dirname(out), { recursive: true })
// Keep any earlier result.json sections (findings, citations) if a caller already wrote them.
let prior = {}
if (existsSync(out)) { try { prior = JSON.parse(readFileSync(out, "utf8")) } catch { prior = {} } }
writeFileSync(out, JSON.stringify({ ...prior, ...report }, null, 2) + "\n")

for (const r of readings) {
  if (!r.valid) { console.log(PREFIX + ` run ${r.run}: INVALID - ${r.why}`); continue }
  console.log(PREFIX + ` run ${r.run}: ext=${r.extIdentity} roles=${r.rolesIdentity} adapterIdentity-lines=${r.identityLineCount} ADAPTER-FALLBACK-lines=${r.fallbackCount}`)
}
console.log(PREFIX + ` valid boots: ${valid.length}/${runs}; fallback: ${fallbackBoots.length}/${valid.length}; clean: ${cleanBoots.length}/${valid.length}`)
console.log(PREFIX + " wrote " + out)
