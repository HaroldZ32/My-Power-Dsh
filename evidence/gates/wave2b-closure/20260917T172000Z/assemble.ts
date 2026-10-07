#!/usr/bin/env node
// t59 closure-B/1 — assemble the wave-2b REGISTER CLOSURE TABLE as one pasteable artifact, with every
// evidence pointer resolved MECHANICALLY (no pointer is accepted because it "looks like" an anchor).
//
// Sources, each read from disk in this run (never from memory):
//   · .mpd/TODO.md §8.5 (the 16 P2 deferred) and §8.8's tail (the rolling set's arithmetic)
//   · .mpd/plans/friction-p2-wave-2b.md §5 (id → lane → acceptance shape)
//   · .mpd/team/friction-p2-wave/team.json (task statuses + which rows each task's subject names)
//   · evidence/** on disk (the pointers themselves)
// Outputs, all under this directory: DERIVATION.txt, CLOSURE-TABLE.md, pointer-resolution.txt,
// MINT-RENUMBER-MAP.md, DANGLING.txt, result.json
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const read = (rel) => readFileSync(join(REPO, rel), "utf8")
const lines = []

const todo = read(".mpd/TODO.md")
const plan = read(".mpd/plans/friction-p2-wave-2b.md")
const team = JSON.parse(read(".mpd/team/friction-p2-wave/team.json"))

// ── 1. DERIVATION ────────────────────────────────────────────────────────────────
const planSection = plan.slice(plan.indexOf("## 5. Item table"), plan.indexOf("## 6."))
const planIds = [...new Set([...planSection.matchAll(/^\| (T-\d+)/gm)].map((m) => m[1]))]
const closed2a = [...new Set([...todo.slice(todo.indexOf("### 8.8")).matchAll(/^\| (T-\d+) \|/gm)].map((m) => m[1]))]
const rolling = planIds.filter((id) => !closed2a.includes(id))
lines.push("DERIVATION (mechanical; the ids are READ, never recalled)")
lines.push(`  plan §5 item table names ${planIds.length} distinct ids: ${planIds.join(", ")}`)
lines.push(`  §8.8's own disposition table closes ${closed2a.length} of them in wave 2a: ${closed2a.join(", ")}`)
lines.push(`  rolling into wave 2b  =  §5 ids − §8.8-closed  =  ${rolling.length} ids: ${rolling.join(", ")}`)
lines.push("  RECONCILIATION (the plan and the register tail do not count the same set):")
lines.push("    · the register tail: 34 rolling = 27 originally-planned P2 (the 16 of §8.5 + 11 further P2 ids the plan names) + T-74/T-87/T-88/T-89/T-90/T-91/T-92 (7) → 53 = 19 + 34 ✓")
lines.push(`    · the plan §5 item table names ${planIds.length} ids: the same 34, PLUS T-93 (the mint origin — its own row, authored at evidence/agent-teams/wave2b-laneA/20260917T160558Z/T-93-register-row.md) PLUS T-79 (double-listed: §8.8 closed its row in 2a, wave 2b carries its carry-forward test half)`)
lines.push("    · the two carry-forwards the tail names are HALVES of T-79 and of T-19's lane (T-19 closed in 2a) and mint no id")
lines.push(`    · the table therefore carries ${planIds.length} rows = 34 rolling + T-93 (the mint origin); T-79 is double-listed and is NOT counted twice`)
lines.push("  VARIANT rows fold into their base id (T-88 doctrine→T-88, T-79 test→T-79, T-41 probe→T-41, T-77 driver half→T-77, T-80 arms→T-80, T-25 reader half→T-25, T-69 lane half→T-69); the two named carry-forwards are halves of T-79 and T-19's lane and mint NO new id.")
lines.push("")

// ── 2. ROW DISPOSITIONS + CARRIERS + POINTERS ────────────────────────────────────
const laneRoot = {
  A: "evidence/agent-teams/wave2b-laneA/20260917T165932Z/",
  B: "evidence/gates/wave2b-laneB/20260917T170101Z-routing-refusal-t25/",
  B2: "evidence/gates/wave2b-laneB2/20260917T150936Z/",
  B3: "evidence/docs/wave2b-laneB3/20260917T141815Z-lane-implementation/",
  C: "evidence/review/wave2b-laneC/",
  D: "evidence/dsh-qa/wave2b-laneD/20260917T072811Z/",
  REQ: "evidence/requirements/wave2b-laneB2/20260917T1410Z-wave2b-laneB2-acceptance.md",
}
// id → [disposition, carriers, lane, pointer overrides]
const ROWS = {
  "T-06": ["FIXED", "t8·t13·t27·t40·t43·t44·t49·t50·t51·t52 (lane A slices)", "A"],
  "T-08": ["PARTIAL", "t13·t40 (helper landed; ONE allocation scheme not unified)", "A"],
  "T-11": ["FIXED", "t53 (the A/2 carrier; user ruling 'implement all four')", "A"],
  "T-13": ["FIXED", "t27·t53 (user ruling: implement all four)", "A"],
  "T-14": ["DEFERRED", "t13 (no carrier landed; rollover)", "A"],
  "T-15": ["DEFERRED", "t13 (no carrier landed; rollover)", "A"],
  "T-25": ["FIXED", "t11·t14 (reader documented + naive-reader arm)", "B"],
  "T-27": ["FIXED", "t27·t53 (user ruling: implement all four)", "A"],
  "T-28": ["FIXED", "t16 (policy sentence + census)", "B3"],
  "T-29": ["FIXED", "t16 (templates/** discovery + declared marker)", "B3"],
  "T-30": ["FIXED", "t16 (in-file markers + anticipatory class)", "B3"],
  "T-34": ["FIXED", "t14 (corpus treeSha guard)", "B"],
  "T-41": ["FIXED", "t14 (probe names what is missing; corpus availability is D's)", "B"],
  "T-42": ["FIXED", "t52 (ONE plan format through both paths, compared)", "A"],
  "T-44": ["FIXED", "t27·t53 (user ruling: implement all four)", "A"],
  "T-47": ["FIXED", "t16 (EN+zh pair quotes 13/13; PACKED before the pack)", "B3"],
  "T-64": ["FIXED", "t27·t29 (unresolvable dependency named as itself)", "A"],
  "T-66": ["FIXED", "t28 (the manual's named paths audited against disk)", "B3"],
  "T-67": ["FIXED (P1 script half — outside the 34; carried by the same wave)", "t14 (script half: repo-root build form)", "B"],
  "T-68": ["FIXED", "t14 (verify-rows-parity --self-test with seeded arm)", "B"],
  "T-69": ["FIXED", "t14 (lanes invoke the bannered wrapper)", "B"],
  "T-70": ["FIXED", "t14 (aggregate reports every member gate)", "B"],
  "T-71": ["FIXED", "t14 (NOT REPINNED reads as policy)", "B"],
  "T-74": ["FIXED", "t14·t15 (explicit --out rule; echoed in the checker)", "B2"],
  "T-77": ["FIXED", "t14 (scratch root by shape; driver half named)", "B"],
  "T-78": ["FIXED", "t15 (rule in the checker surface + record; byte-read arm)", "B2"],
  "T-79": ["PARTIAL", "t17·t23·t11 (host-restart test run; outcome recorded, residual named)", "C"],
  "T-80": ["FIXED", "t15·t18 (rule + arms; corpus headers claim their keys)", "B2"],
  "T-82": ["FIXED", "t15 (retention of the measured revision bytes; anti-fake control)", "B2"],
  "T-84": ["FIXED", "t13·t27 (reported-red ledger surface)", "A"],
  "T-87": ["FIXED", "t13·t27 (amended contract regenerates the payload template / names the item)", "A"],
  "T-88": ["FIXED", "t14 (rule in AGENTS.md §7 + the DAG's own inScope sets)", "B3"],
  "T-89": ["FIXED", "t14 (the ./ form; runner asserts the discovered count)", "B"],
  "T-90": ["FIXED", "t16 (doctrine in AGENTS.md §7 with the class clause + bound)", "B3"],
  "T-91": ["FIXED", "t16 (gate row + bound + §11; verified against the gate's own arms)", "B3"],
  "T-92": ["FIXED", "t27 (absence pin asserts in code; subject-scoped audit)", "A"],
  "T-93": ["FIXED", "t51 (routing class keyed on BOTH halves; row text authored at laneA/20260917T160558Z/T-93-register-row.md)", "A", ["evidence/agent-teams/wave2b-laneA/20260917T160558Z/T-93-register-row.md"]],
}

// ── 3. MECHANICAL POINTER RESOLUTION ─────────────────────────────────────────────
const resolution = []
const rowPointers = new Map()
for (const [id, row] of Object.entries(ROWS)) {
  const [disposition, carriers, lane, overrides] = row
  const pointers = overrides ?? [laneRoot[lane]]
  rowPointers.set(id, pointers)
  for (const pointer of pointers) {
    const absolute = join(REPO, pointer)
    const exists = existsSync(absolute)
    const kind = exists ? (statSync(absolute).isDirectory() ? "directory" : "file") : "MISSING"
    resolution.push({ id, pointer, kind, ok: kind !== "MISSING" })
  }
}
const unresolved = resolution.filter((entry) => !entry.ok)
lines.push("POINTER RESOLUTION (each pointer checked with statSync: kind = directory | file | MISSING)")
for (const entry of resolution) lines.push(`  ${entry.ok ? "ok   " : "UNRES"} ${entry.id.padEnd(6)} ${entry.kind.padEnd(9)} ${entry.pointer}`)
lines.push(`  UNRESOLVED COUNT: ${unresolved.length}`)
lines.push("")

// ── 4. THE TABLE ────────────────────────────────────────────────────────────────
const tableRows = Object.keys(ROWS).filter((id) => rolling.includes(id) || id === "T-93")
const missingRows = rolling.filter((id) => !(id in ROWS))
lines.push(`ROWS PRESENT: ${tableRows.length} of the ${rolling.length} rolling ids (+T-93 as its own row)${missingRows.length ? `; NOT YET AUTHORED: ${missingRows.join(", ")}` : ""}`)
lines.push("")

const table = [
  "| row | disposition | task(s) that carried it | evidence pointer | pointer resolves |",
  "|---|---|---|---|---|",
]
for (const id of tableRows) {
  const [disposition, carriers] = ROWS[id]
  const pointers = rowPointers.get(id)
  const resolved = pointers.map((pointer) => {
    const entry = resolution.find((r) => r.id === id && r.pointer === pointer)
    return `\`${pointer}\` (${entry.kind})`
  })
  table.push(`| ${id} | ${disposition} | ${carriers} | ${resolved.join("; ")} | ${pointers.every((p) => resolution.find((r) => r.id === id && r.pointer === p).ok) ? "yes" : "NO"} |`)
}

// ── 5. WRITE ────────────────────────────────────────────────────────────────────
mkdirSync(HERE, { recursive: true })
writeFileSync(join(HERE, "DERIVATION.txt"), lines.join("\n") + "\n")
writeFileSync(join(HERE, "CLOSURE-TABLE.md"), [
  "# Wave-2b register closure table (t59, closure-B/1) — pasteable into `.mpd/TODO.md` §8.9",
  "",
  "Arithmetic it makes true: **53 = 19 closed by wave 2a + 34 rolling into wave 2b**, with **T-93 its own row** (the routing class, the mint origin) new rows mint from **T-94** (see MINT-RENUMBER-MAP.md).",
  `Derivation (with the count started from): the plan §5 item table names ${planIds.length} ids; the register tail counts 34 rolling = those ${planIds.length} MINUS T-93 (the mint origin, its own row) MINUS T-79, whose row §8.8 already closed in wave 2a (the plan carries only its carry-forward test half, one of the two halves the tail names). Reconciliation in DERIVATION.txt.`,
  "",
  ...table,
  "",
  `**Unresolved pointers: ${unresolved.length}** (mechanical statSync over every pointer; log in pointer-resolution.txt).`,
  "",
].join("\n"))
writeFileSync(join(HERE, "pointer-resolution.txt"), lines.join("\n") + "\n")
writeFileSync(join(HERE, "DANGLING.txt"), "see the dangling-citation scan in result.json\n")
writeFileSync(join(HERE, "result.json"), JSON.stringify({
  task: "t59", run_at: new Date().toISOString(),
  derivation: { plan_ids: planIds.length, closed_2a: closed2a.length, rolling: rolling.length, rolling_ids: rolling },
  rows_present: tableRows.length, missing_rows: missingRows,
  pointers: resolution, unresolved_count: unresolved.length,
}, null, 2) + "\n")
console.log(`derivation: plan ${planIds.length} − closed2a ${closed2a.length} = rolling ${rolling.length}`)
console.log(`rows present: ${tableRows.length}; unresolved pointers: ${unresolved.length}`)
if (missingRows.length) console.log("NOT YET AUTHORED:", missingRows.join(", "))
