#!/usr/bin/env node
/*
 * t5 — evidence hygiene: convert every citation into a PRUNED sandbox tree into a durable one.
 *
 * The captain's pre-flight: the lane's directory carried sandbox working trees (materialized DSH
 * homes, node_modules mirrors, pnpm caches, staged bundle copies) that must not enter the commit.
 * They are deleted; this script then makes the REMAINING evidence self-consistent:
 *   • a string that names a pruned root becomes "<pruned:sandbox>" (never a dead path),
 *   • a load/evidence path that has a durable copy under logs/ is re-pointed at that copy,
 *   • every top-level arm record carries `pruned` metadata,
 * and finally it CHECKS that every path still cited by the durable files exists on disk.
 *
 * Usage: T5_RUN_DIR=<verification run dir> node t5-prune.mjs [--check-only]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PARENT = HERE // this script lives in the verification dir; run dirs are its children
const utc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
const CHECK_ONLY = process.argv.includes("--check-only")

/** Roots deleted before the commit (relative to the verification dir). */
function prunedRoots() {
  const runs = readdirSync(PARENT).filter((d) => /^\d{8}T\d{6}Z$/.test(d))
  const out = []
  for (const r of runs) {
    const base = join(PARENT, r)
    for (const sub of ["sandboxes", "real-web", "real-web-final", "r1-f3-recheck/sandboxes", ".debug"]) out.push(join(base, sub))
    out.push(join(base, "real-install", "dsh"), join(base, "real-install", "home"), join(base, "real-install", "ws"), join(base, "real-install", "cache"))
  }
  return out
}
const PRUNED = prunedRoots()
const TMP_ROOTS = ["/tmp/t5-sandboxes", "/tmp/t5-sandboxes-final", "/tmp/t5-red-sandboxes", "/tmp/dbg", "/tmp/t5-write-probe"]

const isPrunedPath = (value) => typeof value === "string" && value.startsWith("/") &&
  (PRUNED.some((p) => value === p || value.startsWith(p + "/")) || TMP_ROOTS.some((p) => value === p || value.startsWith(p + "/")))

/** Every pruned absolute root appearing ANYWHERE in kept text becomes `<sandbox>` (provenance kept, dead path gone). */
function sanitizeTextFiles() {
  const touched = []
  for (const r of readdirSync(PARENT).filter((d) => /^\d{8}T\d{6}Z$/.test(d))) {
    for (const p of walkFiles(join(PARENT, r))) {
      if (p.endsWith(".mjs")) continue
      let text
      try { text = readFileSync(p, "utf8") } catch { continue }
      let next = text
      for (const root of PRUNED) next = next.split(root).join("<sandbox>")
      for (const root of TMP_ROOTS) next = next.split(root).join("<sandbox-tmp>")
      if (next !== text) { writeFileSync(p, next); touched.push(p.replace(PARENT + "/", "")) }
    }
  }
  return touched
}

function walkFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else if (e.isFile() && (e.name.endsWith(".json") || e.name.endsWith(".md") || e.name.endsWith(".log"))) out.push(p)
  }
  return out
}

/** Deep transform: pruned absolute paths -> a marker; string rewrites also reported. */
function transform(node, report, path = "$") {
  if (Array.isArray(node)) return node.map((v, i) => transform(v, report, path + "[" + i + "]"))
  if (node !== null && typeof node === "object") {
    const out = {}
    for (const [k, v] of Object.entries(node)) out[k] = transform(v, report, path + "." + k)
    return out
  }
  if (isPrunedPath(node)) {
    report.push({ at: path, was: node })
    return "<pruned:sandbox>"
  }
  return node
}

function durableLogFor(file, id, kind) {
  // kind: "matrix" | "r1"
  const candidates = kind === "r1"
    ? [join(file, "r1-f3-recheck", "logs", id + ".boot.log")]
    : [join(file, "logs", id + ".boot.log")]
  return candidates.find((c) => existsSync(c)) ?? null
}

function annotate(file, report) {
  const armsDirs = [
    { dir: join(file, "arms-final"), kind: "matrix" },
    { dir: join(file, "arms"), kind: "matrix" },
    { dir: join(file, "arms-recheck"), kind: "matrix" },
    { dir: join(file, "r1-f3-recheck", "arms"), kind: "r1" },
  ]
  const touched = []
  for (const { dir, kind } of armsDirs) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue
      const p = join(dir, name)
      const arm = JSON.parse(readFileSync(p, "utf8"))
      const localReport = []
      let next = transform(arm, localReport)
      const id = arm.id ?? name.replace(/\.json$/, "")
      const durable = durableLogFor(file, id, kind)
      if (next.load && typeof next.load === "object") {
        if (durable !== null) {
          next.load.logPathDurable = durable
          if (next.load.logPath === "<pruned:sandbox>" || next.load.logPath === undefined) next.load.logPath = durable
        }
        if (next.load.paneFile === "<pruned:sandbox>") next.load.paneFile = (() => {
          const c = join(file, "logs", id + ".tui-pane.txt")
          return existsSync(c) ? c : null
        })()
        if (next.load.rawLogFile === "<pruned:sandbox>") next.load.rawLogFile = (() => {
          const c = join(file, "logs", id + ".tui-raw.log")
          return existsSync(c) ? c : null
        })()
      }
      if (next.stage && typeof next.stage === "object" && next.stage.staged === "<pruned:sandbox>") next.stage.stagedNote = "staged copy deleted before the commit; its frozen patch sha256 above is the durable anchor"
      if (next.before && typeof next.before === "object" && typeof next.before.profile === "string") next.before.profile = next.before.profile.startsWith("/") ? "<pruned:sandbox>" : next.before.profile
      const nullMissing = (obj, key) => {
        if (obj && typeof obj[key] === "string" && obj[key].startsWith("/root/dshProj/") && !existsSync(obj[key])) {
          obj[key + "Missing"] = obj[key]
          obj[key] = null
        }
      }
      nullMissing(next.load, "logPathDurable")
      nullMissing(next.load, "paneFile")
      nullMissing(next.load, "rawLogFile")
      if (next.persisted) for (const k of Object.keys(next.persisted)) nullMissing(next.persisted, k)
      next.pruned = {
        atUtc: utc(),
        sandboxTreesDeleted: true,
        durableEvidence: durable === null ? [] : [durable],
        rewrotePrunedCitations: (arm.pruned?.rewrotePrunedCitations ?? 0) + localReport.length,
        note: "sandbox working trees (DSH homes, node_modules mirrors, caches, staged copies) were deleted before the commit; every dead path is marked <pruned:sandbox> and the durable boot log is the anchor",
      }
      writeFileSync(p, JSON.stringify(next, null, 2) + "\n")
      report.push({ file: p.replace(PARENT + "/", ""), rewrote: localReport.length, durable })
      touched.push(p)
    }
  }
  return touched
}

/** Any citation of a durable path that no longer exists becomes null, with the original kept alongside. */
function repairMissingCitations() {
  const repaired = []
  const walk = (node, onObj) => {
    if (Array.isArray(node)) { node.forEach((v) => walk(v, onObj)); return }
    if (node === null || typeof node !== "object") return
    onObj(node)
    for (const v of Object.values(node)) walk(v, onObj)
  }
  for (const r of readdirSync(PARENT).filter((d) => /^\d{8}T\d{6}Z$/.test(d))) {
    for (const p of walkFiles(join(PARENT, r))) {
      if (!p.endsWith(".json")) continue
      let json
      try { json = JSON.parse(readFileSync(p, "utf8")) } catch { continue }
      let changed = 0
      walk(json, (obj) => {
        for (const [k, v] of Object.entries(obj)) {
          if (k.endsWith("Missing")) continue
          if (typeof v !== "string" || !v.startsWith("/root/dshProj/") || !/\.(log|txt|json|md)$/.test(v)) continue
          if (existsSync(v)) continue
          obj[k + "Missing"] = v
          obj[k] = null
          changed++
        }
      })
      if (changed > 0) { writeFileSync(p, JSON.stringify(json, null, 2) + "\n"); repaired.push({ file: p.replace(PARENT + "/", ""), fields: changed }) }
    }
  }
  return repaired
}

function main() {
  const runs = readdirSync(PARENT).filter((d) => /^\d{8}T\d{6}Z$/.test(d))
  const report = []
  if (!CHECK_ONLY) for (const r of runs) annotate(join(PARENT, r), report)
  const sanitized = CHECK_ONLY ? [] : sanitizeTextFiles()
  const repaired = CHECK_ONLY ? [] : repairMissingCitations()

  // ── the checks the captain asked for ───────────────────────────────────────────────────────
  const remainingPruned = []
  const missingCited = []
  for (const r of runs) {
    for (const p of walkFiles(join(PARENT, r))) {
      if (p.endsWith(".md")) continue
      let text
      try { text = readFileSync(p, "utf8") } catch { continue }
      // (a) no surviving citation into a pruned root
      for (const root of [...PRUNED, ...TMP_ROOTS]) if (text.includes(root)) remainingPruned.push({ file: p.replace(PARENT + "/", ""), root })
      // (b) every path cited by a durable record exists
      if (!p.endsWith(".json")) continue
      let json
      try { json = JSON.parse(text) } catch { continue }
      const stack = [json]
      while (stack.length > 0) {
        const node = stack.pop()
        if (Array.isArray(node)) { stack.push(...node); continue }
        if (node === null || typeof node !== "object") continue
        for (const [k, v] of Object.entries(node)) {
          if (k.endsWith("Missing")) continue
          if (typeof v === "string" && v.startsWith("/root/dshProj/my-power-dsh/") && /\.(log|txt|json|md)$/.test(v)) {
            if (!existsSync(v)) missingCited.push({ file: p.replace(PARENT + "/", ""), field: k, path: v })
          } else if (v !== null && typeof v === "object") stack.push(v)
        }
      }
    }
  }
  const out = {
    atUtc: utc(),
    prunedRoots: PRUNED,
    annotatedArms: report.length,
    sanitizedFiles: sanitized.length,
    repairedCitations: repaired,
    annotationReport: report.slice(0, 60),
    citationsIntoPrunedRootsRemaining: remainingPruned,
    missingCitedDurablePaths: missingCited,
    ok: remainingPruned.length === 0 && missingCited.length === 0,
  }
  mkdirSync(PARENT, { recursive: true })
  writeFileSync(join(PARENT, "prune-check.json"), JSON.stringify(out, null, 2) + "\n")
  console.log(JSON.stringify(out, null, 2))
}

main()
