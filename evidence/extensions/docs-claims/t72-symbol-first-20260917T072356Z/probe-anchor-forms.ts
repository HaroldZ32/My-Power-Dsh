#!/usr/bin/env node
// T-72 probe: WHICH ANCHOR FORMS DOES THE CHECKER ACCEPT?
//
// The register row T-72 says the anchor grammar makes every citation rot because a line number is
// mandatory. The r-E acceptance measured the residual as ENFORCEMENT: the regexes already make
// `:line` optional, but the taught form is `path:line`, a line-number-only anchor is accepted, and
// nothing flags rot. This probe decides that by EXPERIMENT, not by reading: it builds one fixture
// repo per anchor FORM and runs the checker under test over it through the checker's OWN override
// (`DOCS_CLAIMS_REPO`) and its `--citations-only` arm — the same machinery the checker's
// negative control uses. Nothing else is stubbed.
//
// Arms (the document is the variable; the source file is the mutation):
//   symbol-first              `` `alphaSymbol`, `src/probe.ts` ``          no line number at all
//   symbol-first+line         `` `alphaSymbol`, `src/probe.ts:2` ``        the canonical form today
//   line-only                 `` `src/probe.ts:2` ``                       NO symbol anywhere
//   line-only-shadowed        a bare `src/probe.ts:2` in the SAME document as a claim-carrying
//                             anchor with the same path:line                 NO symbol AT THIS SITE
//   symbol-first+line-SHIFT   the SAME document, source moved one line down (rot leg A)
//   symbol-first-SHIFT        the symbol-first document, source moved one line down (rot leg B)
//
// Usage:
//   node probe-anchor-forms.mjs [--checker <path>] [--json <path>]
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const argOf = (flag, fallback) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : fallback)
const CHECKER = resolve(argOf("--checker", join(HERE, "..", "check-citations.mjs")))
const JSON_OUT = argOf("--json", undefined)

// alphaSymbol sits on line 2. The SHIFTED copy is the only mutation anywhere in this probe: one
// inserted comment line, no document touched.
const SOURCE = ["// fixture source", "export const alphaSymbol = 1", "export const betaSymbol = 2", ""]
const SOURCE_SHIFTED = ["// fixture source", "// a later edit inserted this line", "export const alphaSymbol = 1", "export const betaSymbol = 2", ""]

/** One fixture repo carrying the checker's five subjects; `guideBody` is the anchor under test. */
function makeRepo(guideBody, source) {
  const root = mkdtempSync(join(tmpdir(), "t72-anchor-forms-"))
  mkdirSync(join(root, "docs"), { recursive: true })
  mkdirSync(join(root, "src"), { recursive: true })
  writeFileSync(join(root, "src", "probe.ts"), source.join("\n"))
  const write = (rel, body) => writeFileSync(join(root, rel), body)
  write("docs/extension-authoring-guide.md", `# guide\n\n${guideBody}\n`)
  write("docs/extension-authoring-guide.zh-CN.md", `# guide\n\n${guideBody}\n`)
  write("EXTENSIONS-FOR-AGENTS.md", "# contract\n\nSee `alphaSymbol`, `src/probe.ts`.\n")
  write("docs/extension-adaptation-report.md", "# report\n\n## 12. Status\n\nSee `alphaSymbol`, `src/probe.ts`.\n")
  write("docs/extension-adaptation-report.zh-CN.md", "# report\n\n## 12. Status\n\nSee `alphaSymbol`, `src/probe.ts`.\n")
  return root
}

function runArm(guideBody, source) {
  const root = makeRepo(guideBody, source)
  const child = spawnSync(process.execPath, [CHECKER, "--citations-only"], {
    encoding: "utf8",
    env: { ...process.env, DOCS_CLAIMS_REPO: root },
  })
  const output = (child.stdout ?? "") + (child.stderr ?? "")
  rmSync(root, { recursive: true, force: true })
  const guideFailures = output
    .split("\n")
    .filter((line) => line.includes("FAIL") && line.includes("extension-authoring-guide.md"))
    .map((line) => line.trim().slice(0, 240))
  const summary = output.split("\n").filter((line) => line.includes("checks passed")).join(" | ")
  return { exitCode: child.status, guideFailures, summary }
}

const arms = [
  ["symbol-first", "See `alphaSymbol`, `src/probe.ts`.", SOURCE],
  ["symbol-first+line", "See `alphaSymbol`, `src/probe.ts:2`.", SOURCE],
  ["line-only", "See `src/probe.ts:2`.", SOURCE],
  ["line-only-shadowed", "See `alphaSymbol`, `src/probe.ts:2`.\n\nAlso `src/probe.ts:2` is cited here.", SOURCE],
  ["symbol-first+line-SHIFT", "See `alphaSymbol`, `src/probe.ts:2`.", SOURCE_SHIFTED],
  ["symbol-first-SHIFT", "See `alphaSymbol`, `src/probe.ts`.", SOURCE_SHIFTED],
]

const table = {}
console.log(`T-72 anchor-form probe — checker under test: ${CHECKER}`)
console.log("")
for (const [name, guideBody, source] of arms) {
  const result = runArm(guideBody, source)
  table[name] = { exitCode: result.exitCode, guideFailure: result.guideFailures[0] ?? null }
  const verdict = result.exitCode === 0 ? "ACCEPTED" : "FLAGGED"
  console.log(`${verdict.padEnd(9)} ${name.padEnd(24)} exit ${result.exitCode}` + (result.guideFailures[0] ? `\n          ${result.guideFailures[0]}` : ""))
}
const summary = { checker: CHECKER, arms: table }
console.log("")
console.log(JSON.stringify(summary, null, 2))
if (JSON_OUT !== undefined) writeFileSync(resolve(JSON_OUT), JSON.stringify(summary, null, 2) + "\n")
