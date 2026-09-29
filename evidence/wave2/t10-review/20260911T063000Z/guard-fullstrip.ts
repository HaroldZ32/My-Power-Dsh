#!/usr/bin/env node
// t10 (Reviewer) part 2: is the guard's region matching ambiguous, and does the
// VENDOR-REALISTIC full-strip heal restore canonical bytes?
//
// Hypothesis (from guard-copy.mjs): `findRegion` matches markers with
// `line.includes(markerText)`, and three delta ids are PREFIXES of another id
// (scope-overlap ⊂ scope-overlap-normalize, repair-scope ⊂ repair-scope-fields,
// task-contract ⊂ task-contract-render), so removing only the outer region leaves
// the inner region's END marker matching as a "half-open pair".
//
// All work happens on a fresh COPY under this evidence dir.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const scratch = join(here, "guard-fullstrip")
rmSync(scratch, { recursive: true, force: true })
mkdirSync(join(scratch, "scripts"), { recursive: true })
mkdirSync(join(scratch, "packages", "mpd-agent-teams-plugin", "lib"), { recursive: true })
for (const rel of [
  "scripts/patch-agent-teams-fixes.mjs",
  "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js",
  "packages/mpd-agent-teams-plugin/lib/quality-gates.js",
  "packages/mpd-agent-teams-plugin/lib/tools.js",
]) cpSync(join(repoRoot, rel), join(scratch, rel))

const FILES = {
  qg: "packages/mpd-agent-teams-plugin/lib/quality-gates.js",
  tools: "packages/mpd-agent-teams-plugin/lib/tools.js",
}
const canonical = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, readFileSync(join(scratch, rel), "utf8")]))
const guard = join(scratch, "scripts", "patch-agent-teams-fixes.mjs")
const run = (args) => spawnSync(process.execPath, [guard, ...args], { encoding: "utf8", cwd: scratch, timeout: 180_000 })

const stripRegion = (text, id) => {
  const lines = text.split("\n")
  const bi = lines.findIndex((l) => l.includes(`//#region ${id} (`))
  if (bi === -1) return { text, removed: 0 }
  const ei = lines.findIndex((l, i) => i > bi && l.trim().startsWith("//#endregion"))
  return { text: [...lines.slice(0, bi), ...lines.slice(ei + 1)].join("\n"), removed: ei - bi + 1 }
}
const stripAllRegions = (text) => {
  let cur = text, removed = []
  for (;;) {
    const m = cur.match(/^.*\/\/#region (mpd-delta [^\n]+?) \(mpd LOCAL ADAPTATION[^\n]*\n/m)
    if (!m) break
    const id = m[1]
    const r = stripRegion(cur, id)
    if (r.removed === 0) break
    removed.push(id)
    cur = r.text
  }
  return { text: cur, removed }
}
const diffLines = (a, b) => {
  const r = spawnSync("diff", ["-u", "-", "-"], { input: a, encoding: "utf8", timeout: 60_000 })
  void b
  return r
}
const unified = (a, b) => {
  writeFileSync(join(scratch, ".a"), a); writeFileSync(join(scratch, ".b"), b)
  return spawnSync("diff", ["-u", join(scratch, ".a"), join(scratch, ".b")], { encoding: "utf8" }).stdout
}

const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 700) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 260)}`)
}

// ---- 1. prefix-collision probe: strip ONLY the outer of a colliding pair -----
const collisionProbe = []
for (const [outer, inner] of [["mpd-delta scope-overlap", "mpd-delta scope-overlap-normalize"], ["mpd-delta repair-scope", "mpd-delta repair-scope-fields"]]) {
  const r = stripRegion(canonical.qg, outer)
  writeFileSync(join(scratch, FILES.qg), r.text)
  const res = run(["--check"])
  const msg = ((res.stderr ?? "") + (res.stdout ?? "")).trim().split("\n").slice(-1)[0]
  collisionProbe.push({ outer, inner, outerRemovedLines: r.removed, checkExit: res.status, message: msg })
  writeFileSync(join(scratch, FILES.qg), canonical.qg)
}
const collisionConfirmed = collisionProbe.every((p) => /half-open marker pair/.test(p.message) && /begin@-1/.test(p.message))
check("prefix collision confirmed: stripping the OUTER delta of a prefix pair makes --check report a misdiagnosed 'half-open marker pair' (its own end marker is gone; the INNER sibling's end marker still matches the prefix search)",
  collisionConfirmed, JSON.stringify(collisionProbe))

// ---- 2. vendor-realistic FULL strip of each file, then --write heal ---------
const healResults = {}
for (const [key, rel] of Object.entries(FILES)) {
  const { text: stripped, removed } = stripAllRegions(canonical[key])
  writeFileSync(join(scratch, rel), stripped)
  const failCheck = run(["--check"])
  const heal = run(["--write"])
  const healed = readFileSync(join(scratch, rel), "utf8")
  const identical = healed === canonical[key]
  const d = identical ? "" : unified(canonical[key], healed)
  healResults[key] = {
    regionsStripped: removed.length,
    strippedCheckExit: failCheck.status,
    healExit: heal.status,
    identical,
    diffStat: identical ? "0 diff lines" : String(d).split("\n").filter((l) => /^[+-][^+-]/.test(l)).length + " changed lines",
    diffHead: d.split("\n").slice(0, 14),
    healOutput: (heal.stdout ?? "").trim().split("\n").slice(-2).join(" | "),
    checkAfter: ((run(["--check"]).stdout ?? "") + (run(["--check"]).stderr ?? "")).trim().split("\n").slice(-1)[0],
  }
  writeFileSync(join(scratch, rel), canonical[key])
}

check("quality-gates.js: a full-strip then --write heal restores CANONICAL BYTES (t4 A5's vendor-refresh claim)",
  healResults.qg.identical === true, `stripped=${healResults.qg.regionsStripped} healExit=${healResults.qg.healExit} identical=${healResults.qg.identical} ${healResults.qg.diffStat}`)
check("tools.js: a full-strip then --write heal restores CANONICAL BYTES",
  healResults.tools.identical === true, `stripped=${healResults.tools.regionsStripped} healExit=${healResults.tools.healExit} identical=${healResults.tools.identical} ${healResults.tools.diffStat}`)

const out = {
  task: "t10 guard ambiguity + full-strip heal fidelity",
  stamp: new Date().toISOString(),
  collisionProbe,
  collisionConfirmed,
  healResults,
  checks,
}
writeFileSync(join(here, "guard-fullstrip.result.json"), JSON.stringify(out, null, 2))
console.log("\n" + JSON.stringify({ collisionConfirmed, qgIdentical: healResults.qg.identical, qgDiff: healResults.qg.diffStat, toolsIdentical: healResults.tools.identical, toolsDiff: healResults.tools.diffStat }, null, 2))
process.exit(0)
