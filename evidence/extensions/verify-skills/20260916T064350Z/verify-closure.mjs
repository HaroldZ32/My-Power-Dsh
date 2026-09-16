#!/usr/bin/env node

// t11 item 1 — the closure checker's controls, reproduced by the VERIFIER on a
// fixture built from the REAL packer (never from the checker's own fixture code).
//
// Positive control : the real tree must be closed (exit 0).
// Negative control : a temp copy of `scripts/pack-mpd.mjs` with ONE package entry
//                    removed — the historical F-T7-1 defect class (a package the
//                    bundle patch mounts but PLUGIN_PKGS omits) — must exit 1 and
//                    NAME that package.
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const CHECKER = join(REPO, "scripts", "verify-pack-closure.mjs")
const PACKER = join(REPO, "scripts", "pack-mpd.mjs")
const VICTIM = "mpd-ext-plugin"

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
  const result = spawnSync("node", args, { cwd: REPO, encoding: "utf8" })
  return { exitCode: result.status, out: (result.stdout ?? "") + (result.stderr ?? "") }
}

log("verify-closure — item 1 (verifier-owned fixture)")
const sandbox = mkdtempSync(join(tmpdir(), "t11-closure-"))
try {
  // ── positive control on the real tree ─────────────────────────────────────
  const positive = run([CHECKER])
  writeFileSync(join(HERE, "raw", "closure-positive.txt"), positive.out)
  check("positive-control", positive.exitCode === 0, `real tree: exit ${positive.exitCode}; ${positive.out.trim().split("\n").slice(-2).join(" | ")}`)

  // ── the verifier's OWN fixture: one omitted PLUGIN_PKGS entry ─────────────
  const source = readFileSync(PACKER, "utf8")
  const needle = `"${VICTIM}",`
  const occurrences = source.split(needle).length - 1
  const fixture = join(sandbox, "pack-mpd-omission.mjs")
  if (occurrences !== 1) {
    check("fixture-built", false, `expected exactly 1 occurrence of ${needle} in the real packer, found ${occurrences} — refusing to trust a fixture that silently did not apply`)
  } else {
    writeFileSync(fixture, source.split(needle).join(""))
    const fixtureSource = readFileSync(fixture, "utf8")
    const removed = source.length - fixtureSource.length
    check(
      "fixture-built",
      !fixtureSource.includes(`"${VICTIM}"`) && removed > 0 && fixtureSource.includes("const PLUGIN_PKGS = ["),
      `removed ${removed} byte(s) from a temp copy of the real packer; the entry is gone and the array anchor survives`,
    )

    const negative = run([CHECKER, "--packer", fixture])
    writeFileSync(join(HERE, "raw", "closure-negative-omission.txt"), negative.out)
    const names = negative.out.includes(`"${VICTIM}"`) || negative.out.includes(VICTIM)
    check("negative-control-exit", negative.exitCode === 1, `fixture (${VICTIM} omitted): exit ${negative.exitCode}`)
    check("negative-control-names-package", names, `the failure names ${VICTIM}: ${names}`)
    check("negative-control-class", /OMISSION/.test(negative.out), `the failure names the OMISSION class: ${/OMISSION/.test(negative.out)}; ${negative.out.trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`)

    // the fixture must NOT be red for any other reason: put the entry back and expect green
    const restored = join(sandbox, "pack-mpd-restored.mjs")
    writeFileSync(restored, source)
    const restoredRun = run([CHECKER, "--packer", restored])
    writeFileSync(join(HERE, "raw", "closure-negative-restored.txt"), restoredRun.out)
    check("negative-control-isolated", restoredRun.exitCode === 0, `the unmodified copy of the same file is green (exit ${restoredRun.exitCode}) — the red came from the omission, not from the fixture path`)
  }

  // ── the checker's own arms, as a third data point ─────────────────────────
  const selfTest = run([CHECKER, "--self-test"])
  writeFileSync(join(HERE, "raw", "closure-selftest.txt"), selfTest.out)
  const arms = /self-test (PASS|FAIL): (\d+)\/(\d+) arms/.exec(selfTest.out)
  check("checker-selftest", selfTest.exitCode === 0 && arms !== null && arms[2] === arms[3], `exit ${selfTest.exitCode}; ${arms === null ? "no arm summary" : `${arms[2]}/${arms[3]} arms`}`)
} finally {
  rmSync(sandbox, { recursive: true, force: true })
}

const failed = checks.filter((entry) => entry.status === "failed")
writeFileSync(
  join(HERE, "raw", "verify-closure.json"),
  JSON.stringify({ task: "t11", item: "1 — closure checker controls", attempt_id: "f488e6cf-997c-4899-b5bc-897ae67d869c", victim: VICTIM, checks, failed: failed.map((entry) => `${entry.id}: ${entry.detail}`), passed: checks.length - failed.length, total: checks.length }, null, 2) + "\n",
)
writeFileSync(join(HERE, "raw", "verify-closure.log"), logs.join("\n") + "\n")
log(`[t11 item 1] ${checks.length - failed.length}/${checks.length} checks passed, ${failed.length} failed`)
process.exitCode = failed.length === 0 ? 0 : 1
