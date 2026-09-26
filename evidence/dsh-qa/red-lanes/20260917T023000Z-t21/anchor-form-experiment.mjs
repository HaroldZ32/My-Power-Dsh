#!/usr/bin/env node
// Answers docs-gate-engineer's question with a MEASUREMENT, not a reading of the regex:
// does `evidence/extensions/docs-claims/check-citations.mjs` accept a SYMBOL-FIRST anchor with
// NO line number — i.e. `` `alphaSymbol`, `src/probe.ts` ``?
//
// It reuses the checker's OWN negative-control fixture shape (same subject filenames, same
// `DOCS_CLAIMS_REPO` + `--citations-only` invocation) and runs two arms:
//   A: symbol-only anchor whose symbol IS in the cited file   -> must PASS (accepted and verified)
//   B: symbol-only anchor whose symbol is NOT in the cited file -> must FAIL (still falsifiable)
// Usage: node anchor-form-experiment.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const CHECKER = join(REPO, "evidence", "extensions", "docs-claims", "check-citations.mjs")

// The subject filenames come from the checker itself — never re-typed.
const source = readFileSync(CHECKER, "utf8")
const constOf = (name) => {
  const match = new RegExp("const " + name + ' = "([^"]+)"').exec(source)
  if (match === null) throw new Error("cannot read " + name + " from the checker source")
  return match[1]
}
const GUIDE_EN = constOf("GUIDE_EN")
const GUIDE_ZH = constOf("GUIDE_ZH")
const AI_DOC = constOf("AI_DOC")
const REPORT_EN = constOf("REPORT_EN")
const REPORT_ZH = constOf("REPORT_ZH")

function fixture(anchor) {
  const root = mkdtempSync(join(tmpdir(), "t21-anchor-form-"))
  mkdirSync(join(root, "docs"), { recursive: true })
  mkdirSync(join(root, "src"), { recursive: true })
  writeFileSync(join(root, "src", "probe.ts"), ["// fixture", "export const alphaSymbol = 1", "export const betaSymbol = 2", ""].join("\n"))
  const guide = "# fixture guide\n\nSee " + anchor + " for the constant.\n"
  writeFileSync(join(root, GUIDE_EN), guide)
  writeFileSync(join(root, GUIDE_ZH), guide)
  writeFileSync(join(root, AI_DOC), "# fixture contract\n\nSee " + anchor + ".\n")
  writeFileSync(join(root, REPORT_EN), "# fixture report\n\n## 12. Status\n\nSee " + anchor + ".\n")
  writeFileSync(join(root, REPORT_ZH), "# fixture report\n\n## 12. Status\n\nSee " + anchor + ".\n")
  return root
}

function run(root) {
  const child = spawnSync(process.execPath, [CHECKER, "--citations-only"], { encoding: "utf8", env: { ...process.env, DOCS_CLAIMS_REPO: root } })
  const output = (child.stdout ?? "") + (child.stderr ?? "")
  rmSync(root, { recursive: true, force: true })
  return { exitCode: child.status, output }
}

const symbolOnlyPresent = run(fixture("`alphaSymbol`, `src/probe.ts`"))
const symbolOnlyAbsent = run(fixture("`gammaSymbol`, `src/probe.ts`"))
const lineAnchored = run(fixture("`alphaSymbol`, `src/probe.ts:2`"))

const reported = (result) => result.output.split("\n").filter((line) => line.includes("citations:") || line.includes("no content claim") || line.includes("does not carry the claim")).join(" | ").slice(0, 320)

const answer = {
  question: "does the checker accept a symbol-first anchor with NO line number?",
  arms: {
    symbolOnlyPresent: { anchor: "`alphaSymbol`, `src/probe.ts`", exitCode: symbolOnlyPresent.exitCode, accepted: symbolOnlyPresent.exitCode === 0, reported: reported(symbolOnlyPresent) },
    symbolOnlyAbsent: { anchor: "`gammaSymbol`, `src/probe.ts`", exitCode: symbolOnlyAbsent.exitCode, falsifiable: symbolOnlyAbsent.exitCode === 1, reported: reported(symbolOnlyAbsent) },
    lineAnchoredControl: { anchor: "`alphaSymbol`, `src/probe.ts:2`", exitCode: lineAnchored.exitCode, accepted: lineAnchored.exitCode === 0, reported: reported(lineAnchored) },
  },
}
console.log(JSON.stringify(answer, null, 2))

const failures = []
if (!answer.arms.symbolOnlyPresent.accepted) failures.push("a symbol-only anchor whose symbol IS present was not accepted (exit " + symbolOnlyPresent.exitCode + ")")
if (!answer.arms.symbolOnlyAbsent.falsifiable) failures.push("a symbol-only anchor whose symbol is ABSENT did not fail (exit " + symbolOnlyAbsent.exitCode + ") — the accepted form would not be falsifiable")
if (!answer.arms.lineAnchoredControl.accepted) failures.push("the line-anchored control regressed (exit " + lineAnchored.exitCode + ")")
if (failures.length > 0) {
  console.error("[anchor-form] NOT DURABLE:")
  for (const failure of failures) console.error("  - " + failure)
  process.exit(1)
}
console.log("[anchor-form] DURABLE: a symbol-only anchor is accepted when the symbol is in the cited file and still fails when it is not")
