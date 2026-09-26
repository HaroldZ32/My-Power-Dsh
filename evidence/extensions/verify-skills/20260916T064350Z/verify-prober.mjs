#!/usr/bin/env node

// t11 item 2 — the corrected debranding prober, both arms, reproduced by the
// verifier with its OWN mutation (not the prober's built-in fixture).
//
// Positive : the prober on the real tree exits 0 and its probe list covers every
//            probed field of all four kinds.
// Negative : a ONE-BYTE mutation of one probed field inside a TEMP COPY of the
//            shipped example must be REPORTED (exit 1 + a finding), never green.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const PROBER = join(REPO, "evidence", "extensions", "debranding-probe", "20260916T061807Z", "verify-debranding-full.mjs")
const EXAMPLE = join(REPO, "extensions", "mpd-ext-example")

const checks = []
const logs = []
const log = (text) => {
  logs.push(text)
  process.stdout.write(text + "\n")
}
const check = (id, ok, detail) => {
  checks.push({ id, status: ok ? "passed" : "failed", detail })
  log(`  ${ok ? "ok  " : "FAIL"} ${id} — ${detail}`)
  return ok
}
const run = (args) => {
  const result = spawnSync("node", [PROBER, ...args], { cwd: REPO, encoding: "utf8" })
  return { exitCode: result.status, out: (result.stdout ?? "") + (result.stderr ?? "") }
}

log("verify-prober — item 2 (verifier-owned mutation)")
const sandbox = mkdtempSync(join(tmpdir(), "t11-prober-"))
try {
  // ── positive arm: exit 0 + a probe list covering every field ───────────────
  const positiveJson = join(HERE, "raw", "prober-positive.json")
  const positive = run(["--json-out", positiveJson])
  writeFileSync(join(HERE, "raw", "prober-positive.stdout.txt"), positive.out)
  check("positive-exit", positive.exitCode === 0, `exit ${positive.exitCode}; ${positive.out.trim().split("\n").slice(-1)[0].slice(0, 160)}`)
  const report = JSON.parse(readFileSync(positiveJson, "utf8"))
  const kinds = report.totals?.fieldsPerKind ?? {}
  const probedKinds = Object.keys(kinds)
  check(
    "positive-probe-list-complete",
    report.totals?.findings === 0 &&
      report.totals?.probes === 26 &&
      report.probeList?.length === report.totals?.probes &&
      ["skills", "flows", "roles", "mcp"].every((kind) => probedKinds.includes(kind)),
    `probes=${report.totals?.probes} list=${report.probeList?.length} findings=${report.totals?.findings} kinds=[${probedKinds}] fields/kinds=${JSON.stringify(kinds)}`,
  )

  // ── the verifier's OWN one-byte mutation of one probed field ──────────────
  const mutated = join(sandbox, "mutated-example")
  cpSync(EXAMPLE, mutated, { recursive: true })
  const manifestPath = join(mutated, "mpd-ext.json")
  const before = readFileSync(manifestPath, "utf8")
  const original = JSON.parse(before).contributes.roles[0].name
  const MUTATED = original + "X"
  const after = before.replace(`"name": "${original}"`, `"name": "${MUTATED}"`)
  const applied = after !== before && after.includes(MUTATED)
  writeFileSync(manifestPath, after)
  check("mutation-applied", applied, `roles[0].name "${original}" -> "${MUTATED}" (exactly one byte added) in a TEMP copy; the real example is untouched`)

  const mutatedJson = join(HERE, "raw", "prober-mutated.json")
  const negative = run(["--example-root", mutated, "--json-out", mutatedJson])
  writeFileSync(join(HERE, "raw", "prober-mutated.stdout.txt"), negative.out)
  check("negative-exit", negative.exitCode === 1, `mutated example: exit ${negative.exitCode} (must be 1)`)
  const mutatedReport = existsSync(mutatedJson) ? JSON.parse(readFileSync(mutatedJson, "utf8")) : undefined
  check(
    "negative-reported-as-finding",
    (mutatedReport?.totals?.findings ?? 0) > 0 && JSON.stringify(mutatedReport.findings ?? []).includes(MUTATED),
    `findings=${mutatedReport?.totals?.findings ?? "n/a"}; the finding names the mutated value: ${JSON.stringify(mutatedReport?.findings ?? []).includes(MUTATED)}`,
  )
  check("negative-names-field", /roles\.name/.test(JSON.stringify(mutatedReport?.findings ?? [])), `the finding names roles.name: ${/roles\.name/.test(JSON.stringify(mutatedReport?.findings ?? []))}`)

  // ── the prober's own --self-test (its built-in mutation arm) ──────────────
  const selfTest = spawnSync("node", [PROBER, "--self-test"], { cwd: REPO, encoding: "utf8" })
  const selfOut = (selfTest.stdout ?? "") + (selfTest.stderr ?? "")
  writeFileSync(join(HERE, "raw", "prober-selftest.txt"), selfOut)
  check("prober-selftest", selfTest.status === 0, `exit ${selfTest.status}; ${selfOut.trim().split("\n").slice(-2).join(" | ").slice(0, 200)}`)
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}

const failed = checks.filter((entry) => entry.status === "failed")
writeFileSync(
  join(HERE, "raw", "verify-prober.json"),
  JSON.stringify({ task: "t11", item: "2 — corrected prober, both arms", attempt_id: "f488e6cf-997c-4899-b5bc-897ae67d869c", checks, failed: failed.map((entry) => `${entry.id}: ${entry.detail}`), passed: checks.length - failed.length, total: checks.length }, null, 2) + "\n",
)
writeFileSync(join(HERE, "raw", "verify-prober.log"), logs.join("\n") + "\n")
log(`[t11 item 2] ${checks.length - failed.length}/${checks.length} checks passed, ${failed.length} failed`)
process.exitCode = failed.length === 0 ? 0 : 1
