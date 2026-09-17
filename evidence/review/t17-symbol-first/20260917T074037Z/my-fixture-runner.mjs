#!/usr/bin/env node
// t17 REVIEWER'S OWN FIXTURE (never the author's). Built from the rule as written, not from the
// checker's own negative control: my symbol names, my source file, my document layout.
//
// Arms (each a self-contained fixture repo; the 5 subjects must exist for every arm):
//   baseline-symbol-first          `reviewProbeWidget`, `src/reviewprobe.ts`          -> both revisions GREEN
//   rot-bare                       `src/reviewprobe.ts:2`      (no claim anywhere)   -> both revisions RED (different messages)
//   rot-shadowed                   bare :2  + a SIBLING claim for the SAME path:line elsewhere in the SAME doc
//                                                                                    -> frozen GREEN (exit 0), durable RED (the flip)
//   line-dependent-accepted        `reviewProbeWidget`, `src/reviewprobe.ts:2`       -> durable GREEN (not a mass re-anchor)
//   symbol-first-survives-shift    symbol-first, cited file shifted under it         -> durable GREEN
//   line-dependent-drifted         line-bearing, same shift                          -> durable RED (content mismatch)
import { spawnSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const REVIEW_DIR = dirname(new URL(import.meta.url).pathname)
const FROZEN = join(REVIEW_DIR, "../../../../evidence/extensions/docs-claims/check-citations.mjs")
const DURABLE = join(REVIEW_DIR, "../../../../scripts/check-citations.mjs")

const SOURCE = ["// review fixture source — mine (t17)", "export const reviewProbeWidget = 41", "export function reviewProbeHelper() { return reviewProbeWidget }", ""]
const SHIFTED = ["// review fixture source — mine (t17)", "// a later edit inserted this line", "export const reviewProbeWidget = 41", "export function reviewProbeHelper() { return reviewProbeWidget }", ""]

const NEUTRAL_GUIDE = "# reviewer fixture guide\n\nNo citation is placed in this file for this arm.\n"
const NEUTRAL_CONTRACT = "# reviewer fixture contract\n\nNo citation is placed in this file for this arm.\n"
const NEUTRAL_REPORT = "# reviewer fixture report\n\n## 12. Status\n\nNothing to report here.\n"

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
  // Adversarial probe: can the NEW rot verdict be silenced by the documented pending annotation?
  { id: "rot-pending-annotated", source: SOURCE, guide: "# reviewer fixture guide\n\n<!-- citation-check: pending T-99 -->\nSee `src/reviewprobe.ts:2` for the widget.\n" },
  // Adversarial probes of the SYMBOL-FIRST arm (claims are matched per PATH over the whole document
  // there, not per site — does a WRONG line-free claim survive when a correct one exists?):
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
  const root = join(REVIEW_DIR, "fixtures", arm.id)
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

function run(checker, root, rawPath, label) {
  const child = spawnSync(process.execPath, [checker, "--citations-only"], { encoding: "utf8", env: { ...process.env, DOCS_CLAIMS_REPO: root } })
  const output = (child.stdout ?? "") + (child.stderr ?? "")
  writeFileSync(rawPath, output)
  // A FAILURE line only: the summary line "0 line-number-only anchor(s) FLAGGED as rot" also
  // contains the phrase, so classify by the "FAIL <arm>" prefix, never by substring alone.
  const failLine = (needle) => output.split("\n").filter((line) => /^\s*FAIL /.test(line) && line.includes(needle)).map((line) => line.trim().slice(0, 240))
  const rot = failLine("line-number-only anchor")
  const contentMiss = failLine("does not carry the claim")
  const noClaim = failLine("no content claim")
  const summary = output.trim().split("\n").filter((line) => line.includes("checks passed")).at(-1) ?? ""
  return { exitCode: child.status, summary: summary.slice(0, 220), rot, contentMiss, noClaim, raw: rawPath.replace(REVIEW_DIR + "/", "") }
}

const report = { instrument: "reviewer's own fixtures (mine, under evidence/review/...)", frozen: FROZEN, durable: DURABLE, arms: {} }
mkdirSync(join(REVIEW_DIR, "raw"), { recursive: true })
for (const arm of arms) {
  const root = build(arm)
  report.arms[arm.id] = {
    guide: arm.guide,
    source: arm.source.join("\n"),
    frozen: run(FROZEN, root, join(REVIEW_DIR, "raw", `${arm.id}-frozen.out`), "frozen"),
    durable: run(DURABLE, root, join(REVIEW_DIR, "raw", `${arm.id}-durable.out`), "durable"),
  }
}
console.log(JSON.stringify(report, null, 2))
