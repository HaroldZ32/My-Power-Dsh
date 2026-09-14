// t15 docs-lane checks: the contract's three verify commands plus the
// non-historical-reference sweep, captured as one reproducible record.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = "/root/dshProj/my-power-dsh"
const outJson = join(repoRoot, "evidence/mpd-naming/docs-lane/raw/checks.json")
const run = (cmd, args) => {
  try {
    const stdout = execFileSync(cmd, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    return { exitCode: 0, stdout: stdout.toString() }
  } catch (error) {
    return { exitCode: error.status ?? 1, stdout: (error.stdout ?? Buffer.from("")).toString(), stderr: (error.stderr ?? Buffer.from("")).toString() }
  }
}
const sha256 = (p) => createHash("sha256").update(readFileSync(join(repoRoot, p))).digest("hex")

const checks = {}

// VERIFY 1 — the pair exists, the old pair is gone.
const v1 = run("bash", ["-c", "test -f docs/upstream-parity-ledger.md && test -f docs/upstream-parity-ledger.zh-CN.md && test ! -e docs/omo-parity-ledger.md && test ! -e docs/omo-parity-ledger.zh-CN.md"])
checks.verify1_filepair = { command: "test -f docs/upstream-parity-ledger.md && test -f docs/upstream-parity-ledger.zh-CN.md && test ! -e docs/omo-parity-ledger.md && test ! -e docs/omo-parity-ledger.zh-CN.md", exitCode: v1.exitCode }

// VERIFY 2 — no stale path in docs/ except the exempt process records.
const v2 = run("bash", ["-c", "git grep -n 'omo-parity-ledger' -- docs/ ':!docs/plan-*.md' ':!docs/omo-parity-gap.md' || true"])
checks.verify2_no_stale_path = { command: "git grep -n \"omo-parity-ledger\" -- docs/ ':!docs/plan-*.md' ':!docs/omo-parity-gap.md'", exitCode: 0, output: v2.stdout.trim(), expectation: "no output", passed: v2.stdout.trim() === "" }

// VERIFY 3 — exactly one reciprocal switch link per file, on the line under the title.
const v3 = run("bash", ["-c", "grep -n '\\[中文\\]\\|\\[English\\]' docs/upstream-parity-ledger.md docs/upstream-parity-ledger.zh-CN.md"])
const v3lines = v3.stdout.trim().split("\n").filter(Boolean)
checks.verify3_switch_links = {
  command: "grep -n \"\\[中文\\]\\|\\[English\\]\" docs/upstream-parity-ledger.md docs/upstream-parity-ledger.zh-CN.md",
  exitCode: v3.exitCode,
  matches: v3lines,
  passed: v3lines.length === 2 && v3lines.every((l) => /:2:/.test(l))
}

// Non-historical sweep beyond docs/: nothing outside docs/ + evidence/ cites the old path.
const wide = run("bash", ["-c", "git grep -n 'omo-parity-ledger' -- . ':!docs/' ':!evidence/' || true"])
checks.wide_sweep = { command: "git grep -n \"omo-parity-ledger\" -- . ':!docs/' ':!evidence/'", output: wide.stdout.trim(), passed: wide.stdout.trim() === "" }

// History KEPT.
const kept = run("bash", ["-c", "grep -c 'omo-parity-align' docs/upstream-parity-ledger.md; grep -c 'evidence/omo-align' docs/upstream-parity-ledger.md; grep -c 'evidence/omo-align' docs/upstream-parity-ledger.zh-CN.md"])
checks.history_kept = {
  wave_id_hits_en: Number(kept.stdout.trim().split("\n")[0]),
  evidence_citations_en: Number(kept.stdout.trim().split("\n")[1]),
  evidence_citations_zh: Number(kept.stdout.trim().split("\n")[2]),
  passed: Number(kept.stdout.trim().split("\n")[0]) >= 1 && Number(kept.stdout.trim().split("\n")[1]) >= 1
}

// Exempt process records untouched.
const exempt = run("bash", ["-c", "git status --porcelain docs/omo-parity-gap.md docs/plan-*.md docs/decisions.md || true"])
checks.exempt_records = { command: "git status --porcelain docs/omo-parity-gap.md docs/plan-*.md docs/decisions.md", output: exempt.stdout.trim(), passed: exempt.stdout.trim() === "" }

checks.files = {
  "docs/upstream-parity-ledger.md": sha256("docs/upstream-parity-ledger.md"),
  "docs/upstream-parity-ledger.zh-CN.md": sha256("docs/upstream-parity-ledger.zh-CN.md"),
  "docs/index.md": sha256("docs/index.md"),
  "docs/index.zh-CN.md": sha256("docs/index.zh-CN.md")
}
checks.title_and_links = {
  en_title: readFileSync(join(repoRoot, "docs/upstream-parity-ledger.md"), "utf8").split("\n")[0],
  en_line2: readFileSync(join(repoRoot, "docs/upstream-parity-ledger.md"), "utf8").split("\n")[1],
  zh_title: readFileSync(join(repoRoot, "docs/upstream-parity-ledger.zh-CN.md"), "utf8").split("\n")[0],
  zh_line2: readFileSync(join(repoRoot, "docs/upstream-parity-ledger.zh-CN.md"), "utf8").split("\n")[1],
  switch_targets_exist: existsSync(join(repoRoot, "docs/upstream-parity-ledger.md")) && existsSync(join(repoRoot, "docs/upstream-parity-ledger.zh-CN.md"))
}

checks.allPassed = Object.entries(checks).filter(([, v]) => v && typeof v.passed === "boolean").every(([, v]) => v.passed)
mkdirSync(join(repoRoot, "evidence/mpd-naming/docs-lane/raw"), { recursive: true })
writeFileSync(outJson, JSON.stringify(checks, null, 2) + "\n")
console.log(JSON.stringify({
  verify1: checks.verify1_filepair.exitCode,
  verify2_empty: checks.verify2_no_stale_path.passed,
  verify3: checks.verify3_switch_links.passed,
  wide_sweep_empty: checks.wide_sweep.passed,
  history_kept: checks.history_kept,
  exempt_untouched: checks.exempt_records.passed,
  allPassed: checks.allPassed
}, null, 2))
