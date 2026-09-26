#!/usr/bin/env node
// t21 FINAL verification — run only when t47 and t50 are TERMINAL and the workmate real-home guard
// predicate is fixed. It reproduces the four contract verify commands with raw output, confirms the
// docs-claims six FAILs are gone, and writes `final/final-verify.json` + one raw log per command.
//
//   node evidence/dsh-qa/red-lanes/20260917T023000Z-t21/final-verify.mjs
//   exit 0 = all four green (t21 can be completed); exit 1 = something is still open (see the table)
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const OUT = join(HERE, "final")
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const COMMANDS = [
  { name: "verify1-workmate-library-real", argv: ["bun", "skills/dsh-qa/scripts/workmate-library.mjs", "--no-skip"], laneEvidence: "evidence/plan-f/workmate-library" },
  { name: "verify2-extension-template-selftest", argv: ["bun", "skills/dsh-qa/scripts/extension-template.mjs", "--self-test"], laneEvidence: null },
  { name: "verify3-workmate-library-selftest", argv: ["bun", "skills/dsh-qa/scripts/workmate-library.mjs", "--self-test"], laneEvidence: null },
  { name: "verify4-check-citations", argv: ["node", "evidence/extensions/docs-claims/check-citations.mjs"], laneEvidence: "evidence/extensions/docs-claims/runs" },
]

const results = []
for (const command of COMMANDS) {
  const logPath = join(OUT, command.name + ".log")
  const started = Date.now()
  const child = spawnSync(command.argv[0], command.argv.slice(1), { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const output = (child.stdout ?? "") + (child.stderr ?? "")
  writeFileSync(logPath, output)
  const summaryLine = output.split("\n").filter((line) => /checks passed|self-test\] ok|PASS|ok=/.test(line)).slice(-2).join(" | ").slice(0, 300)
  const docsTotals = /\[docs-claims\] (\d+)\/(\d+) checks passed, (\d+) failed/.exec(output)
  results.push({
    command: command.argv.join(" "),
    exitCode: child.status,
    status: child.status === 0 ? "passed" : "failed",
    durationMs: Date.now() - started,
    log: "final/" + command.name + ".log",
    summary: summaryLine,
    ...(docsTotals ? { docsChecks: { passed: Number(docsTotals[1]), total: Number(docsTotals[2]), failed: Number(docsTotals[3]) } } : {}),
    ...(child.status === 0 ? {} : { note: "investigate the raw log above; a failing workmate-library at this point means the guard predicate is still unfixed" }),
  })
}

// The two blockers t21 is parked on, read from disk rather than assumed.
const guardSrc = join(REPO, "packages", "mpd-workmate-plugin", "src", "index.ts")
const guardText = existsSync(guardSrc) ? readFileSync(guardSrc, "utf8") : ""
const guardFixed = /const realHome = userInfo\(\)\.homedir|userInfo\(\)\.homedir/.test(guardText)
const checkerProbe = spawnSync(process.execPath, [join(HERE, "anchor-form-experiment.mjs")], { cwd: REPO, encoding: "utf8" })
const t55FormDurable = checkerProbe.status === 0

const allGreen = results.every((entry) => entry.status === "passed")
const report = {
  task: "t21 final verification",
  recordedAt: new Date().toISOString(),
  allGreen,
  expected: "all four exit 0, docs-claims 12/12 with 0 failed, workmate-library flow proven from the session log and files present",
  guardPredicateFixed: guardFixed,
  t55SymbolFirstFormDurable: t55FormDurable,
  artifacts: {
    "skills/dsh-qa/scripts/workmate-library.mjs": null,
    "skills/dsh-qa/scripts/extension-template.mjs": null,
    "skills/dsh-qa/scripts/lib/immutable-output.mjs": null,
    "evidence/extensions/docs-claims/check-citations.mjs": null,
  },
  results,
}
writeFileSync(join(OUT, "final-verify.json"), JSON.stringify(report, null, 2) + "\n")

console.log("== t21 final verification ==")
for (const entry of results) console.log("  " + (entry.status === "passed" ? "ok  " : "FAIL") + " " + entry.command + " -> exit " + entry.exitCode + " (" + entry.durationMs + " ms)  " + (entry.summary ?? ""))
console.log("  guard predicate fixed: " + guardFixed + " | T-55 symbol-first form durable: " + t55FormDurable)
console.log("  wrote " + join(OUT, "final-verify.json"))
console.log(allGreen ? "[final-verify] ALL FOUR GREEN — t21 can be completed with these raw logs" : "[final-verify] STILL OPEN — do not complete; see the failing command's raw log")
process.exit(allGreen ? 0 : 1)
