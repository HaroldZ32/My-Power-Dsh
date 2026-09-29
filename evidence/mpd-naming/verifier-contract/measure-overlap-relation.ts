// Two-sided measurement of the B7 overlap relation behind the create-task sibling
// validator (`inScopeOverlap`). RED arm: the PRE-FIX body, materialized from git HEAD,
// imported as a real module. GREEN arm: the working tree's body, imported the same way.
// The case set is the one the wave-4 defect was measured with: an independent lane
// wrongly refused, and a parent/child pair wrongly admitted.
//
//   node evidence/mpd-naming/verifier-contract/measure-overlap-relation.mjs
//
// Exit 0 only when the two arms disagree on exactly the two measured classes.
import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const LIB = join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib")
const HEAD_FILE = "packages/mpd-agent-teams-plugin/lib/quality-gates.js"

const CASES = [
  // [left inScope, right inScope, expected overlap]
  [["docs/index.md"], ["scripts/build-mcp.mjs"], false],
  [["docs/upstream-parity-ledger.md"], ["docs/index.md"], false],
  [["packages/foo/lib"], ["packages/foo/test"], false],
  [["src/**"], ["srcx/a.ts"], false],
  [["docs/**"], ["src/**"], false],
  [["docs"], ["docs/index.md"], true],
  [["packages/foo"], ["packages/foo/vendor"], true],
  [["a"], ["a"], true],
  [["docs/**"], ["docs/index.md"], true],
  [["packages/*/dist"], ["packages/foo/dist/cli.js"], true],
  [["**"], ["docs/index.md"], true],
]

const scratch = join(repoRoot, ".qa-reloc", "overlap-relation-head")
rmSync(scratch, { recursive: true, force: true })
mkdirSync(scratch, { recursive: true })
const headLib = join(scratch, "lib")
cpSync(LIB, headLib, { recursive: true })
const headSource = execFileSync("git", ["show", `HEAD:${HEAD_FILE}`], { cwd: repoRoot, encoding: "utf8" })
writeFileSync(join(headLib, "quality-gates.js"), headSource)

const prefix = await import(join(headLib, "quality-gates.js"))
const current = await import(join(LIB, "quality-gates.js"))

const rows = CASES.map(([left, right, expected]) => {
  const before = prefix.inScopeOverlap(left, right)
  const after = current.inScopeOverlap(left, right)
  return { left, right, expected, preFix: before.length > 0, fixed: after.length > 0, verdictNow: after.length > 0 === expected }
})
const prefixWrong = rows.filter((row) => row.preFix !== row.expected)
const nowWrong = rows.filter((row) => !row.verdictNow)
const report = {
  headFile: HEAD_FILE,
  headSha256: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
  preFixWrongCases: prefixWrong.length,
  fixedWrongCases: nowWrong.length,
  measured: rows,
}
const outDir = join(repoRoot, "evidence", "mpd-naming", "verifier-contract")
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, "overlap-relation-result.json"), JSON.stringify(report, null, 2) + "\n")
writeFileSync(join(outDir, "overlap-relation-output.log"),
  rows.map((row) => `${row.expected ? "overlap " : "disjoint"} ${JSON.stringify(row.left)} vs ${JSON.stringify(row.right)} | preFix=${row.preFix} fixed=${row.fixed}`).join("\n") + "\n")
console.log("[overlap-relation] cases=" + rows.length + " preFixWrong=" + prefixWrong.length + " fixedWrong=" + nowWrong.length)
for (const row of rows) {
  console.log("  " + (row.expected ? "overlap " : "disjoint") + " " + JSON.stringify(row.left) + " vs " + JSON.stringify(row.right) + " | preFix=" + row.preFix + " fixed=" + row.fixed)
}
if (prefixWrong.length === 0 || nowWrong.length !== 0) {
  console.error("[overlap-relation] FAIL: expected the pre-fix relation to be wrong on >=1 case and the fixed one on none")
  process.exit(1)
}
console.log("[overlap-relation] PASS: RED " + prefixWrong.length + " case(s), GREEN 0")
