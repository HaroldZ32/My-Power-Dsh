// t13 (review-B) falsification harness — lane C's INDEPENDENT active tests of lane B's gate rules.
//
// The question this file answers: was any rule made green by WEAKENING it? The two rules that moved
// under t26's repair are the ones worth attacking:
//   (1) the ROOT-FILE byte rule: its old hard check was deleted from rule 5b and re-homed into the
//       content sweep as a provenance-named EXPECTED class. A packed-side mutation must STILL hard-fail
//       when the source did not move after the stamp — tested here with a pinned stamp;
//   (2) the COMPLETENESS rule: a declared source file with no counterpart in the artifact must fail.
//
// Every leg runs against a SCRATCH COPY of `dist/mpd-package` (cpSync preserves timestamps) — the
// canonical artifact is never written, and its stamp is read before and after the whole file.
//
// Usage: node review-falsification.mjs <evidence-dir>   (from the repo root)
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const repo = process.cwd()
const dir = process.argv[2]
if (dir === undefined || dir === "") {
  console.error("usage: node review-falsification.mjs <evidence-dir>")
  process.exit(2)
}

const PACKED = "dist/mpd-package"
const ROOT_FILE = "EXTENSIONS-FOR-AGENTS.md"
const ASSET_TO_DELETE = "skills/dsh-qa/SKILL.md"

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")
const stamp = () => {
  const text = execFileSync("find", [PACKED, "-type", "f", "-printf", "%P\t%s\t%T@\n"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const files = execFileSync("find", [PACKED, "-type", "f"], { cwd: repo, encoding: "utf8" }).trim().split("\n").filter(Boolean).length
  return { digest: createHash("sha256").update(text).digest("hex").slice(0, 16), files }
}

/** Run the closure gate over one scratch pack; returns exit code + the findings it printed. */
const closure = (packed, extraArgs = []) => {
  const args = ["scripts/verify-pack-closure.mjs", "--packed", packed, "--source-root", repo, ...extraArgs]
  let exitCode = 0
  let output = ""
  try {
    output = execFileSync(process.execPath, args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    exitCode = error.status ?? -1
    output = String(error.stdout ?? "") + String(error.stderr ?? "")
  }
  const findings = output.split("\n").filter((line) => line.includes("CONTENT-DRIFT") || line.includes("FAIL") || line.includes("MISSING") || line.includes("absent"))
  return {
    exitCode,
    ok: output.includes("ok:"),
    hardDrift: findings.filter((line) => line.includes("CONTENT-DRIFT") && !line.includes("CONTENT-DRIFT-EXPECTED")),
    expectedDrift: findings.filter((line) => line.includes("CONTENT-DRIFT-EXPECTED")),
    findings: findings.slice(0, 6),
  }
}

const copyOf = (scratch, label) => {
  const target = join(scratch, label)
  cpSync(PACKED, target, { recursive: true, preserveTimestamps: true })
  return target
}

const before = stamp()
const scratch = mkdtempSync(join(tmpdir(), "t13-falsify-"))
const legs = {}
try {
  // ── Leg A: the packed-side root-file mutation, with the stamp PINNED to now ─────────────────
  // The pin is the falsifier for the "EXPECTED" escape hatch: with the stamp at/after every source
  // mtime, "the source was NOT written after the stamp" is true for every file, so a byte difference
  // can no longer be excused as a post-pack write.
  const pinnedAt = new Date().toISOString()
  const cleanCopy = copyOf(scratch, "clean")
  legs.A_control_clean_pinned_stamp = closure(cleanCopy, ["--pack-stamp", pinnedAt])

  const mutatedCopy = copyOf(scratch, "mutated-root")
  const rootPath = join(mutatedCopy, ROOT_FILE)
  const original = readFileSync(rootPath, "utf8")
  writeFileSync(rootPath, original + "\n<!-- t13 review: one byte-class mutation on the PACKED side -->\n")
  legs.B_packed_root_mutation_pinned_stamp = closure(mutatedCopy, ["--pack-stamp", pinnedAt])

  // ── Leg C: a declared source file with no counterpart in the artifact ───────────────────────
  const incompleteCopy = copyOf(scratch, "missing-asset")
  const deleted = join(incompleteCopy, ASSET_TO_DELETE)
  const existedBefore = existsSync(deleted)
  rmSync(deleted, { recursive: true, force: true })
  legs.C_shipped_file_missing = { asset: ASSET_TO_DELETE, existedBefore, ...closure(incompleteCopy, ["--pack-stamp", pinnedAt]) }

  // ── Leg D: the SAME mutated pack WITHOUT a pinned stamp (the real-tree shape) ───────────────
  const realStampCopy = copyOf(scratch, "mutated-root-realstamp")
  const rootPath2 = join(realStampCopy, ROOT_FILE)
  writeFileSync(rootPath2, readFileSync(rootPath2, "utf8") + "\n<!-- t13 review: mutation with the inferred stamp -->\n")
  legs.D_packed_root_mutation_inferred_stamp = closure(realStampCopy)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
const after = stamp()

const report = {
  schema: "review-B/t13-falsification/1",
  captured_at: new Date().toISOString(),
  question: "was any moved rule made green by weakening it?",
  repo_head: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  gate_script_sha256: sha("scripts/verify-pack-closure.mjs"),
  artifact_read_only: { before, after, identical: before.digest === after.digest && before.files === after.files },
  legs,
  verdict: {
    A_control_green: legs.A_control_clean_pinned_stamp.exitCode === 0,
    B_packed_mutation_hard_red: legs.B_packed_root_mutation_pinned_stamp.exitCode !== 0 && legs.B_packed_root_mutation_pinned_stamp.hardDrift.length > 0,
    C_missing_artifact_file_red: legs.C_shipped_file_missing.exitCode !== 0,
    D_inferred_stamp_reported: legs.D_packed_root_mutation_inferred_stamp.exitCode !== 0,
  },
}
writeFileSync(join(dir, "falsification.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ artifact_read_only: report.artifact_read_only.identical, legs: Object.fromEntries(Object.entries(legs).map(([k, v]) => [k, { exit: v.exitCode, hard: v.hardDrift?.length ?? null, expected: v.expectedDrift?.length ?? null }])), verdict: report.verdict }, null, 2))
