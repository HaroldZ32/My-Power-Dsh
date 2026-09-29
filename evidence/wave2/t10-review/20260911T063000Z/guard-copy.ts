#!/usr/bin/env node
// t10 (Reviewer) independent vendor-refresh durability test, run on a COPY.
//
// The guard (`scripts/patch-agent-teams-fixes.mjs`) accepts a `root` override, so
// this driver mirrors the two-file relative layout into a scratch root and drives
// the guard there: the shared tree is never mutated.
//
// For each registered delta in the copy:
//   1. baseline `--check` must exit 0
//   2. strip the region -> `--check` must exit NON-ZERO and NAME the delta
//   3. `--write` must heal it, and the healed file must be byte-identical to the
//      canonical file (the durable claim) — measured, not asserted
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const scratch = join(here, "guard-copy")
rmSync(scratch, { recursive: true, force: true })
mkdirSync(join(scratch, "scripts"), { recursive: true })
mkdirSync(join(scratch, "packages", "mpd-agent-teams-plugin", "lib"), { recursive: true })
for (const rel of [
  "scripts/patch-agent-teams-fixes.mjs",
  "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js",
  "packages/mpd-agent-teams-plugin/lib/quality-gates.js",
  "packages/mpd-agent-teams-plugin/lib/tools.js",
]) cpSync(join(repoRoot, rel), join(scratch, rel))

const canonical = {
  "packages/mpd-agent-teams-plugin/lib/quality-gates.js": readFileSync(join(scratch, "packages/mpd-agent-teams-plugin/lib/quality-gates.js"), "utf8"),
  "packages/mpd-agent-teams-plugin/lib/tools.js": readFileSync(join(scratch, "packages/mpd-agent-teams-plugin/lib/tools.js"), "utf8"),
}
const guard = join(scratch, "scripts", "patch-agent-teams-fixes.mjs")
const run = (args) => spawnSync(process.execPath, [guard, ...args], { encoding: "utf8", cwd: scratch, timeout: 180_000 })
const sha = (p) => spawnSync("sha256sum", [p], { encoding: "utf8" }).stdout.split(/\s+/)[0]

const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 600) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 220)}`)
}

// 1. baseline
const base = run(["--check"])
check("baseline --check on the copy exits 0 (all registered regions present and byte-identical)",
  base.status === 0, `exit=${base.status} ${(base.stdout ?? "").trim().split("\n").slice(-2).join(" | ")}`)

// registry ids, in order
const registry = readFileSync(join(scratch, "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js"), "utf8")
const ids = [...registry.matchAll(/id: "([^"]+)"/g)].map((m) => m[1])
const fileOf = {}
for (const m of registry.matchAll(/file: "([^"]+)"[\s\S]{0,200}?id: "([^"]+)"/g)) fileOf[m[2]] = m[1]
// fall back: read each file's begin markers to map id -> file
const markerFile = {}
for (const rel of Object.keys(canonical)) {
  for (const mm of canonical[rel].matchAll(/\/\/#region (mpd-delta [^\s]+) \(mpd LOCAL ADAPTATION/g)) markerFile[mm[1]] = rel
}

// 2+3. per-delta strip -> fail -> heal -> byte-compare
const perDelta = []
for (const id of ids) {
  const rel = markerFile[id] ?? fileOf[id]
  if (!rel) { perDelta.push({ id, rel: null, strippedCheck: null, healedIdentical: null, note: "file mapping not found" }); continue }
  const abs = join(scratch, rel)
  const before = canonical[rel]
  const lines = before.split("\n")
  const bi = lines.findIndex((l) => l.includes(`//#region ${id} (`))
  const ei = lines.findIndex((l) => l.includes(`//#endregion ${id} `) || l.includes(`//#endregion ${id})`))
  const endIdx = ei === -1 ? lines.findIndex((l, i) => i > bi && l.trim().startsWith("//#endregion")) : ei
  if (bi === -1 || endIdx === -1) { perDelta.push({ id, rel, note: `markers not found bi=${bi} ei=${endIdx}` }); continue }
  const stripped = [...lines.slice(0, bi), ...lines.slice(endIdx + 1)].join("\n")
  writeFileSync(abs, stripped)
  const failRun = run(["--check"])
  const named = failRun.status !== 0 && ((failRun.stderr ?? "") + (failRun.stdout ?? "")).includes(id)
  const healRun = run(["--write"])
  const healed = readFileSync(abs, "utf8")
  const identical = healed === before
  const diff = spawnSync("diff", ["-u", "-", "-"], { input: healed, encoding: "utf8" })
  const healLines = healed.split("\n").length - before.split("\n").length
  perDelta.push({
    id, rel, strippedCheckExit: failRun.status, strippedCheckNamed: named, healExit: healRun.status,
    healedIdentical: identical, lineDelta: healLines,
    healOutput: (healRun.stdout ?? "").trim().split("\n").slice(-2).join(" | "),
    failOutput: ((failRun.stderr ?? "") + (failRun.stdout ?? "")).trim().split("\n").slice(-2).join(" | "),
  })
  // restore the canonical copy for the next iteration
  writeFileSync(abs, before)
}

const gate = perDelta.filter((d) => d.rel === "packages/mpd-agent-teams-plugin/lib/quality-gates.js")
const tools = perDelta.filter((d) => d.rel === "packages/mpd-agent-teams-plugin/lib/tools.js")
check("every registered delta: a stripped region makes --check exit NON-ZERO and name the delta",
  perDelta.every((d) => d.strippedCheckNamed === true), JSON.stringify(perDelta.map((d) => ({ id: d.id, exit: d.strippedCheckExit, named: d.strippedCheckNamed }))))
check("quality-gates.js: every stripped region heals back BYTE-IDENTICAL (the durability claim)",
  gate.length > 0 && gate.every((d) => d.healedIdentical === true), JSON.stringify(gate.map((d) => ({ id: d.id, identical: d.healedIdentical, lineDelta: d.lineDelta }))))
check("tools.js: every stripped region heals back BYTE-IDENTICAL",
  tools.length > 0 && tools.every((d) => d.healedIdentical === true), JSON.stringify(tools.map((d) => ({ id: d.id, identical: d.healedIdentical, lineDelta: d.lineDelta }))))

const out = {
  task: "t10 independent vendor-refresh durability test on a COPY",
  stamp: new Date().toISOString(),
  scratch,
  registryIds: ids,
  markerFile,
  baselineCheck: { exit: base.status, output: (base.stdout ?? "").trim().split("\n").slice(-3) },
  perDelta,
  checks,
  qualityGatesAllByteIdentical: gate.every((d) => d.healedIdentical === true),
  toolsAllByteIdentical: tools.every((d) => d.healedIdentical === true),
  allPass: checks.every((c) => c.pass),
}
writeFileSync(join(here, "guard-copy.result.json"), JSON.stringify(out, null, 2))
console.log("\n" + JSON.stringify({ qualityGatesAllByteIdentical: out.qualityGatesAllByteIdentical, toolsAllByteIdentical: out.toolsAllByteIdentical, allPass: out.allPass }, null, 2))
process.exit(0)
