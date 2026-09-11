#!/usr/bin/env node
// t7 (Reviewer) orphan-row matrix + OLD-format-registry guard audit.
// Runs the REAL applier (scripts/patch-agent-teams-fixes.mjs) against a farm copy
// of the two adopted files and the REAL registry, one scenario per canon row
// (Architect ruling, inbox senior-engineer msg 1 item 4/5; t1 record A2).
// Records the ACTUAL behaviour so each row can be marked canon-compliant or not.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = "/root/dshProj/my-power-dsh"
const FARM = join(here, "work", "t7-farm")
const REL = "packages/mpd-agent-teams-plugin/lib"
const FILES = ["quality-gates.js", "tools.js"]
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 1200) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 260)}`)
}

const registry = await import("file://" + join(repoRoot, REL, "mpd-deltas.js"))
const { MPD_DELTAS, MPD_DELTA_MARKERS } = registry
const canonical = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(repoRoot, REL, f), "utf8")]))

rmSync(FARM, { recursive: true, force: true })
mkdirSync(join(FARM, "scripts"), { recursive: true })
mkdirSync(join(FARM, REL), { recursive: true })
cpSync(join(repoRoot, "scripts", "patch-agent-teams-fixes.mjs"), join(FARM, "scripts", "patch-agent-teams-fixes.mjs"))
cpSync(join(repoRoot, REL), join(FARM, REL), { recursive: true })
const APPLIER = join(FARM, "scripts", "patch-agent-teams-fixes.mjs")

const spanOf = (lines, id) => {
  const begin = lines.findIndex((l) => l.trim() === MPD_DELTA_MARKERS.begin(id))
  const end = lines.findIndex((l) => l.trim() === MPD_DELTA_MARKERS.end(id))
  return { begin, end }
}
const reset = () => { for (const f of FILES) writeFileSync(join(FARM, REL, f), canonical[f]) }
const readFarm = (f) => readFileSync(join(FARM, REL, f), "utf8")
const run = (args) => spawnSync("node", [APPLIER, ...args], { cwd: FARM, encoding: "utf8" })

function scenario(id, mutate, args) {
  reset()
  const target = MPD_DELTAS.find((d) => d.id === id)
  const file = target.file.split("/").pop()
  const lines = readFarm(file).split("\n")
  mutate(lines, spanOf(lines, id))
  writeFileSync(join(FARM, REL, file), lines.join("\n"))
  const r = run(args)
  return { file, before: lines.join("\n"), exit: r.status, out: (r.stdout ?? "") + (r.stderr ?? ""), healed: readFarm(file) }
}

// ---------------------------------------------------------------- canon rows ---
// R1: both present, end < begin -> `half-open marker pair` FAIL (only this case)
const r1 = scenario("mpd-delta task-contract", (lines, s) => {
  const [end] = lines.splice(s.end, 1)
  lines.splice(s.begin, 0, end) // end marker now precedes the begin marker
}, ["--check"])
check("R1 both markers present, end<begin -> FAIL with `half-open marker pair` (canon: only this case may say half-open)",
  r1.exit === 1 && /half-open marker pair/.test(r1.out) && /task-contract/.test(r1.out),
  `exit=${r1.exit} out=${r1.out.trim().slice(0, 220)}`)

// R2: begin present + end absent + body byte-equal -> re-bracket in place
const r2 = scenario("mpd-delta update-task-required-status-param", (lines, s) => { lines.splice(s.end, 1) }, ["--write"])
check("R2 begin present, end absent, body byte-equal -> re-bracket in place, file byte-identical to canonical",
  r2.exit === 0 && r2.healed === canonical["tools.js"],
  `exit=${r2.exit} byte-identical=${r2.healed === canonical["tools.js"]} out=${r2.out.trim().slice(0, 200)}`)

// R3: begin present + end absent + body DRIFTED -> canon: FAIL naming region AND line
const r3 = scenario("mpd-delta update-task-required-status-param", (lines, s) => {
  lines.splice(s.end, 1)
  lines[s.begin + 3] = lines[s.begin + 3] + " // t7-drift" // authored edit inside the region
}, ["--write"])
check("R3 begin present, end absent, body DRIFTED -> canon FAIL naming the region AND the line (authored text must not be silently replaced)",
  r3.exit === 1 && new RegExp("update-task-required-status-param").test(r3.out) && /FAIL/.test(r3.out) && /line\s+\d+/.test(r3.out),
  `exit=${r3.exit} out=${r3.out.trim().slice(0, 260)} ; drift line retained in healed file=${/t7-drift/.test(r3.healed)}`)

// R4: end present + begin absent + body byte-equal -> re-bracket in place
const r4 = scenario("mpd-delta update-task-required-status-param", (lines, s) => { lines.splice(s.begin, 1) }, ["--write"])
check("R4 end present, begin absent, body byte-equal -> re-bracket in place, file byte-identical to canonical",
  r4.exit === 0 && r4.healed === canonical["tools.js"],
  `exit=${r4.exit} byte-identical=${r4.healed === canonical["tools.js"]} out=${r4.out.trim().slice(0, 200)}`)

// R5: end present + begin absent + nothing survived -> drop the single orphan end line + heal
const r5 = scenario("mpd-delta update-task-required-status-param", (lines, s) => {
  lines.splice(s.begin, s.end - s.begin) // remove begin marker + whole body, keep the end marker
}, ["--write"])
check("R5 end present, begin absent, body gone -> drop the single orphan end line and heal from context (byte-identical)",
  r5.exit === 0 && r5.healed === canonical["tools.js"],
  `exit=${r5.exit} byte-identical=${r5.healed === canonical["tools.js"]} out=${r5.out.trim().slice(0, 200)}`)

// R6: OLD-format registry + a missing region -> canon: the named migration message
const oldRegistry = []
oldRegistry.push("/** t7 old-format registry fixture (pre-migration shape: anchor fields, no context pair). */")
oldRegistry.push("export const MPD_DELTA_MARKERS = {")
oldRegistry.push("    begin: (id) => `//#region ${id} (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`,")
oldRegistry.push("    end: (id) => `//#endregion ${id}`,")
oldRegistry.push("};")
oldRegistry.push("export const MPD_DELTAS = [")
for (const d of MPD_DELTAS) {
  const anchor = d.block.split("\n")[1] ?? ""
  oldRegistry.push(`    { file: ${JSON.stringify(d.file)}, id: ${JSON.stringify(d.id)}, anchor: ${JSON.stringify(anchor)}, anchorOccurrence: 1, anchorMarker: null, block: ${JSON.stringify(d.block)} },`)
}
oldRegistry.push("];")
writeFileSync(join(FARM, REL, "mpd-deltas.js"), oldRegistry.join("\n"))
const r6 = scenario("mpd-delta repair-scope", (lines, s) => {
  lines.splice(s.begin, s.end - s.begin + 1) // remove the whole region: the heal must locate its seam
}, ["--write"])
check("R6 OLD-format registry (anchor fields, no before/afterContext) + a missing region -> canon: the named migration message, never a bare TypeError",
  r6.exit === 1 && /OLD anchor format/.test(r6.out) && /--write-registry/.test(r6.out),
  `exit=${r6.exit} out=${r6.out.trim().slice(0, 300)}`)
writeFileSync(join(here, "old-registry-fixture.js"), readFileSync(join(FARM, REL, "mpd-deltas.js"), "utf8"))
// restore the REAL registry before the later scenarios (R6 replaced it in the farm)
writeFileSync(join(FARM, REL, "mpd-deltas.js"), readFileSync(join(repoRoot, REL, "mpd-deltas.js"), "utf8"))

// R3b: same shape, --check mode (canon A2 requires a FAIL naming the line)
const r3b = scenario("mpd-delta update-task-required-status-param", (lines, s) => {
  lines.splice(s.end, 1)
  lines[s.begin + 3] = lines[s.begin + 3] + " // t7-drift"
}, ["--check"])
check("R3b same drifted shape in --check mode -> canon: FAIL naming the region AND the line",
  r3b.exit === 1 && /line\s+\d+/.test(r3b.out) && /update-task-required-status-param/.test(r3b.out) && /restore|--write-registry/.test(r3b.out),
  `exit=${r3b.exit} out=${r3b.out.trim().slice(0, 300)}`)

// R3c: drift by DELETION of a body line (authored text removed) — does the drop+heal still refuse?
const r3c = scenario("mpd-delta update-task-required-status-param", (lines, s) => {
  lines.splice(s.end, 1)
  lines.splice(s.begin + 3, 1)
}, ["--write"])
check("R3c drifted-by-deletion -> canon: FAIL naming the region AND the line; the file must stay byte-untouched",
  r3c.exit === 1 && /FAIL/.test(r3c.out) && /line\s+\d+/.test(r3c.out) && r3c.healed === r3c.before,
  `exit=${r3c.exit} fileUntouched=${r3c.healed === r3c.before} out=${r3c.out.trim().slice(0, 260)}`)

// R7 (DECISIVE): strip EVERY region from BOTH adopted files in the same state,
// heal once with --write, and compare each file to canonical byte-for-byte.
function stripAllRegions(text) {
  let lines = text.split("\n")
  for (;;) {
    const b = lines.findIndex((l) => /^\s*\/\/#region mpd-delta [A-Za-z0-9-]+ \(/.test(l))
    if (b === -1) return lines.join("\n")
    const id = /\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(lines[b])[1]
    const e = lines.findIndex((l, at) => at > b && l.trim() === MPD_DELTA_MARKERS.end(id))
    if (e === -1) throw new Error("unterminated fixture region " + id)
    lines = [...lines.slice(0, b), ...lines.slice(e + 1)]
  }
}
reset()
for (const f of FILES) writeFileSync(join(FARM, REL, f), stripAllRegions(canonical[f]))
const r7 = run(["--write"])
const r7check = run(["--check"])
check("R7 DECISIVE strip-both: every region removed from both files in the same state -> one --write heals BOTH byte-identically, then --check exits 0",
  r7.status === 0 && r7check.status === 0 && FILES.every((f) => readFarm(f) === canonical[f]),
  `writeExit=${r7.status} checkExit=${r7check.status} toolsIdentical=${readFarm("tools.js") === canonical["tools.js"]} qgIdentical=${readFarm("quality-gates.js") === canonical["quality-gates.js"]} out=${(r7.stdout ?? "").trim().slice(0, 200)}`)

// R8: the migration must stay usable — with the OLD-format registry in place,
// `--write-registry` regenerates it (exit 0, 12 context pairs, no anchor keys),
// and the applier then runs `--check` clean.
reset() // adopted files INTACT: the migration regenerates from their marked regions
const old2 = []
old2.push("export const MPD_DELTA_MARKERS = {")
old2.push("    begin: (id) => `//#region ${id} (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`,")
old2.push("    end: (id) => `//#endregion ${id}`,")
old2.push("};")
old2.push("export const MPD_DELTAS = [")
for (const d of MPD_DELTAS) old2.push(`    { file: ${JSON.stringify(d.file)}, id: ${JSON.stringify(d.id)}, anchor: "x", anchorOccurrence: 1, anchorMarker: null, block: ${JSON.stringify(d.block)} },`)
old2.push("];")
writeFileSync(join(FARM, REL, "mpd-deltas.js"), old2.join("\n"))
const r8writeRegistry = run(["--write-registry"])
const regenerated = readFileSync(join(FARM, REL, "mpd-deltas.js"), "utf8")
const r8check = run(["--check"])
const r8entries = (regenerated.match(/^\s*id: "mpd-delta /gm) ?? []).length
const r8pairs = r8entries === 12 && (regenerated.match(/^\s*beforeContext: \[/gm) ?? []).length === 12 && (regenerated.match(/^\s*afterContext: \[/gm) ?? []).length === 12
check("R8 migration stays usable: OLD-format registry + --write-registry -> exit 0, 12 context pairs, no anchor keys, then --check exit 0",
  r8writeRegistry.status === 0 && r8pairs && !/anchorOccurrence|anchorMarker/.test(regenerated) && r8check.status === 0 && FILES.every((f) => readFarm(f) === canonical[f]),
  `writeRegistryExit=${r8writeRegistry.status} pairs=${r8pairs} anchorKeys=${/anchorOccurrence|anchorMarker/.test(regenerated)} checkExit=${r8check.status} out=${(r8writeRegistry.stdout ?? "").trim().slice(0, 160)}`)
writeFileSync(join(here, "migration-regenerated-registry.js"), regenerated)

const result = {
  task: "t7 orphan-row matrix + OLD-format-registry guard audit",
  stamp: new Date().toISOString(),
  canon: "Architect ruling (inbox senior-engineer msg 1, items 4-5) + t1 decision record A2",
  applier: "scripts/patch-agent-teams-fixes.mjs (real file, copied into a farm with the real registry)",
  rows: {
    R1_half_open: { exit: r1.exit, out: r1.out },
    R2_rebracket_end_absent_intact: { exit: r2.exit, byteIdentical: r2.healed === canonical["tools.js"] },
    R3_begin_present_end_absent_drifted: { exit: r3.exit, out: r3.out, driftRetained: /t7-drift/.test(r3.healed), fileUntouched: r3.healed === r3.before },
    R3b_drifted_check_mode: { exit: r3b.exit, out: r3b.out },
    R3c_drifted_by_deletion: { exit: r3c.exit, out: r3c.out, fileUntouched: r3c.healed === r3c.before },
    R4_rebracket_begin_absent_intact: { exit: r4.exit, byteIdentical: r4.healed === canonical["tools.js"] },
    R5_orphan_end_drop_and_heal: { exit: r5.exit, byteIdentical: r5.healed === canonical["tools.js"] },
    R6_old_format_registry: { exit: r6.exit, out: r6.out },
    R8_migration_path: { writeRegistryExit: r8writeRegistry.status, entries: (regenerated.match(/^\s*id: "mpd-delta /gm) ?? []).length, checkExit: r8check.status },
    R7_strip_both_decisive: { writeExit: r7.status, checkExit: r7check.status, toolsIdentical: readFarm("tools.js") === canonical["tools.js"], qualityGatesIdentical: readFarm("quality-gates.js") === canonical["quality-gates.js"] },
  },
  checks,
  allPass: checks.every((c) => c.pass),
}
writeFileSync(join(here, "orphan-rows.result.json"), JSON.stringify(result, null, 2))
console.log("\n" + (result.allPass ? "PASS" : "FAIL") + " — orphan-rows.result.json (" + checks.filter((c) => c.pass).length + "/" + checks.length + ")")
process.exit(result.allPass ? 0 : 1)
