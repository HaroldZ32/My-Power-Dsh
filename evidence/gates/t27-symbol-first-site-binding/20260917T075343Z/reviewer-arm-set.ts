#!/usr/bin/env node
// t27 repair evidence: the INDEPENDENT REVIEWER'S own arm set (t17), re-run by lane B2.
//
// Provenance: the arms, their fixture shapes and the neutral subject files are copied VERBATIM from
// `evidence/review/t17-symbol-first/20260917T074037Z/my-fixture-runner.mjs` (the reviewer's own
// fixture, built from the rule as written). The ONLY changes are mechanical: the repo root is
// resolved from this file's location, and every artifact is written INSIDE this task's inScope
// (`evidence/gates/t27-.../`) instead of into the reviewer's sealed directory.
//
// Why it exists: F3's acceptance requires "no failure-mode move, proven by re-running its arm set" —
// so this runs BEFORE and AFTER the repair and compares exit codes arm by arm.
import { spawnSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const FROZEN = join(REPO, "evidence", "extensions", "docs-claims", "check-citations.mjs")
const DURABLE = join(REPO, "scripts", "check-citations.mjs")
const LABEL = process.argv.includes("--label") ? process.argv[process.argv.indexOf("--label") + 1] : "run"
const OUT = join(HERE, `arm-set-${LABEL}`)

const SOURCE = ["// review fixture source — mine (t17)", "export const reviewProbeWidget = 41", "export function reviewProbeHelper() { return reviewProbeWidget }", ""]
const SHIFTED = ["// review fixture source — mine (t17)", "// a later edit inserted this line", "export const reviewProbeWidget = 41", "export function reviewProbeHelper() { return reviewProbeWidget }", ""]

const NEUTRAL_GUIDE = "# reviewer fixture guide\n\nNo citation is placed in this file for this arm.\n"
const NEUTRAL_CONTRACT = "# reviewer fixture contract\n\nNo citation is placed in this file for this arm.\n"
const NEUTRAL_REPORT = "# reviewer fixture report\n\n## 12. Status\n\nNothing to report here.\n"

// ── the reviewer's arms, verbatim ────────────────────────────────────────────
const arms = [
  { id: "baseline-symbol-first", source: SOURCE, guide: "# reviewer fixture guide\n\nSee `reviewProbeWidget`, `src/reviewprobe.ts` for the widget.\n" },
  { id: "rot-bare", source: SOURCE, guide: "# reviewer fixture guide\n\nSee `src/reviewprobe.ts:2` for the widget.\n" },
  {
    id: "rot-shadowed",
    source: SOURCE,
    guide: [
      "# reviewer fixture guide",
      "",
      "See `src/reviewprobe.ts:2` for the widget.",
      "",
      "The factory is named `reviewProbeWidget`, `src/reviewprobe.ts:2`.",
      "",
    ].join("\n"),
  },
  { id: "line-dependent-accepted", source: SOURCE, guide: "# reviewer fixture guide\n\nSee `reviewProbeWidget`, `src/reviewprobe.ts:2` for the widget.\n" },
  { id: "symbol-first-survives-shift", source: SHIFTED, guide: "# reviewer fixture guide\n\nSee `reviewProbeWidget`, `src/reviewprobe.ts` for the widget.\n" },
  { id: "line-dependent-drifted", source: SHIFTED, guide: "# reviewer fixture guide\n\nSee `reviewProbeWidget`, `src/reviewprobe.ts:2` for the widget.\n" },
  { id: "rot-pending-annotated", source: SOURCE, guide: "# reviewer fixture guide\n\n<!-- citation-check: pending T-99 -->\nSee `src/reviewprobe.ts:2` for the widget.\n" },
  {
    id: "symbol-first-wrong-then-right",
    source: SOURCE,
    guide: "# reviewer fixture guide\n\nSee `definitelyNotASymbol`, `src/reviewprobe.ts` for the widget.\n\nThe factory is `reviewProbeWidget`, `src/reviewprobe.ts`.\n",
  },
  {
    id: "symbol-first-right-then-wrong",
    source: SOURCE,
    guide: "# reviewer fixture guide\n\nThe factory is `reviewProbeWidget`, `src/reviewprobe.ts`.\n\nSee `definitelyNotASymbol`, `src/reviewprobe.ts` for the widget.\n",
  },
]

function build(arm) {
  const root = join(OUT, "fixtures", arm.id)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, "docs"), { recursive: true })
  mkdirSync(join(root, "src"), { recursive: true })
  writeFileSync(join(root, "src", "reviewprobe.ts"), arm.source.join("\n"))
  writeFileSync(join(root, "docs", "extension-authoring-guide.md"), arm.guide)
  writeFileSync(join(root, "docs", "extension-authoring-guide.zh-CN.md"), NEUTRAL_GUIDE)
  writeFileSync(join(root, "EXTENSIONS-FOR-AGENTS.md"), NEUTRAL_CONTRACT)
  writeFileSync(join(root, "docs", "extension-adaptation-report.md"), NEUTRAL_REPORT)
  writeFileSync(join(root, "docs", "extension-adaptation-report.zh-CN.md"), NEUTRAL_REPORT)
  return root
}

function run(checker, root, rawPath) {
  const child = spawnSync(process.execPath, [checker, "--citations-only"], { encoding: "utf8", env: { ...process.env, DOCS_CLAIMS_REPO: root } })
  const output = (child.stdout ?? "") + (child.stderr ?? "")
  writeFileSync(rawPath, output)
  const failLines = output.split("\n").filter((line) => /^\s*FAIL /.test(line)).map((line) => line.trim().slice(0, 260))
  const summary = output.trim().split("\n").filter((line) => line.includes("checks passed")).at(-1) ?? ""
  return { exitCode: child.status, verdict: child.status === 0 ? "ACCEPTED (exit 0)" : "FLAGGED (exit 1)", failLines, summary: summary.slice(0, 220) }
}

mkdirSync(join(OUT, "raw"), { recursive: true })
const report = { label: LABEL, instrument: "reviewer's own arm set (t17), re-run by lane B2 from evidence/gates/t27-...", frozen: FROZEN, durable: DURABLE, arms: {} }
for (const arm of arms) {
  const root = build(arm)
  report.arms[arm.id] = {
    frozen: run(FROZEN, root, join(OUT, "raw", `${arm.id}-frozen.out`)),
    durable: run(DURABLE, root, join(OUT, "raw", `${arm.id}-durable.out`)),
  }
}
console.log(`[t27 arm set ${LABEL}] checker under test: ${DURABLE}`)
console.log("")
for (const [id, result] of Object.entries(report.arms)) {
  console.log(`${id.padEnd(31)} frozen: ${result.frozen.verdict.padEnd(18)} durable: ${result.durable.verdict}`)
  const fail = result.durable.failLines[0]
  if (fail !== undefined) console.log(`    ${fail.slice(0, 200)}`)
}
writeFileSync(join(HERE, `arm-set-${LABEL}.json`), JSON.stringify(report, null, 2) + "\n")
console.log("")
console.log(`[t27 arm set ${LABEL}] wrote ${join(HERE, `arm-set-${LABEL}.json`)}`)
