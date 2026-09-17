// t13 (review-B) falsification harness — lane C's INDEPENDENT active tests of lane B's gate rules.
//
// THE QUESTION: was any rule made green by WEAKENING it? Method matters more than the assertion here,
// so this harness is DIFFERENTIAL: every mutated pack is compared, finding-line by finding-line, against
// a CLEAN pack read in the same run under the same stamp. A finding that appears in the mutated copy and
// not in the clean one is caused by the mutation; anything present in both is the real tree's own state.
//
// The first version of this harness pinned the stamp to "now" and made even the CLEAN control red (24
// hard drifts) — a valid rule reacting to a false stamp claim, not a defect. That method is withdrawn and
// the corrected one is below: mutate a file whose SOURCE has not moved since the pack, so the
// EXPECTED (post-pack writer) escape hatch cannot apply to it.
//
// The canonical artifact is never written: the scratch copies are cpSync'd with preserved timestamps and
// the artifact stamp is read before/after the whole file.
//
// Usage: node review-falsification.mjs <evidence-dir>   (from the repo root)
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const repo = process.cwd()
const dir = process.argv[2]
if (dir === undefined || dir === "") {
  console.error("usage: node review-falsification.mjs <evidence-dir>")
  process.exit(2)
}

const PACKED = "dist/mpd-package"
const ROOT_FILE = "EXTENSIONS-FOR-AGENTS.md"

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")
const stamp = () => {
  const text = execFileSync("find", [PACKED, "-type", "f", "-printf", "%P\t%s\t%T@\n"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const files = execFileSync("find", [PACKED, "-type", "f"], { cwd: repo, encoding: "utf8" }).trim().split("\n").filter(Boolean).length
  return { digest: createHash("sha256").update(text).digest("hex").slice(0, 16), files, method: "sha256 over the UNSORTED `find dist/mpd-package -type f -printf '%P\\t%s\\t%T@\\n'` listing (+ file count)" }
}

let PINNED_STAMP = null
const closure = (packed) => {
  const args = ["scripts/verify-pack-closure.mjs", "--packed", packed, "--source-root", repo, ...(PINNED_STAMP === null ? [] : ["--pack-stamp", PINNED_STAMP])]
  let exitCode = 0
  let output = ""
  try {
    output = execFileSync(process.execPath, args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    exitCode = error.status ?? -1
    output = String(error.stdout ?? "") + String(error.stderr ?? "")
  }
  const lines = output.split("\n").filter((line) => line.trim() !== "")
  const findings = lines.filter((line) => /CONTENT-DRIFT|FAIL|MISSING|absent|drift|completeness/.test(line))
  return {
    exitCode,
    outputHead: lines.slice(-8),
    verdictLine: lines.find((line) => line.includes("ok:")) ?? lines.find((line) => line.includes("FAIL")) ?? lines[0] ?? "",
    contentBytes: lines.find((line) => line.includes("content bytes:")) ?? null,
    completeness: lines.find((line) => line.includes("completeness:")) ?? null,
    findings,
    hardFindings: findings.filter((line) => line.includes("CONTENT-DRIFT") && !line.includes("CONTENT-DRIFT-EXPECTED")),
    expectedFindings: findings.filter((line) => line.includes("CONTENT-DRIFT-EXPECTED")),
  }
}

/** The files whose source did not move after the pack: a mutation there can only be drift. */
const unchangedSincePack = () => {
  const listed = execFileSync("find", [PACKED, "-type", "f", "-printf", "%P\n"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split("\n").filter(Boolean)
  const packedStamp = Date.now() - 1
  // %T@ is SECONDS since epoch; Date and statSync().mtimeMs are MILLISECONDS (bug fixed after the
  // first run reported 1970-01-21 and therefore found no candidates — withdrawn, not smoothed).
  const artifactNewest = Math.max(...execFileSync("find", [PACKED, "-type", "f", "-printf", "%T@\n"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split("\n").filter(Boolean).map(Number)) * 1000
  const candidates = []
  for (const rel of listed) {
    if (rel === ROOT_FILE) continue
    const source = join(repo, rel)
    if (!existsSync(source)) continue
    const sourceMtime = statSync(source).mtimeMs
    if (sourceMtime > artifactNewest) continue // a post-pack writer: the EXPECTED class applies
    if (!readFileSync(source).equals(readFileSync(join(PACKED, rel)))) continue // already drifted: not our control
    candidates.push({ rel, sourceMtime: new Date(sourceMtime).toISOString() })
    candidates.push({ rel, sourceMtime: new Date(sourceMtime).toISOString() })
  }
  const groups = ["agent-references/", "templates/", "skills/", "docs/"]
  const perGroup = groups.map((prefix) => candidates.find((c) => c.rel.startsWith(prefix))).filter(Boolean)
  return { artifactNewest: new Date(artifactNewest).toISOString(), candidates: candidates.slice(0, 3), perGroup }
}

const before = stamp()
// The canonical artifact's OWN inferred stamp, read before anything is copied. Pinning it in every leg
// is what makes the legs comparable: a write inside a scratch copy moves the INFERRED stamp forward and
// would reclassify every honest post-pack writer as a hard drift (measured in the superseded v1 pass).
PINNED_STAMP = execFileSync("find", [PACKED, "-type", "f", "-printf", "%T@\n"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split("\n").filter(Boolean).map(Number).reduce((a, b) => Math.max(a, b), 0)
PINNED_STAMP = new Date(PINNED_STAMP * 1000).toISOString()
const chosen = unchangedSincePack()
const scratch = mkdtempSync(join(tmpdir(), "t13-falsify-"))
const legs = {}
let target = chosen.candidates[0]?.rel ?? "skills/dsh-qa/SKILL.md"
const copyOf = (label) => {
  const target = join(scratch, label)
  cpSync(PACKED, target, { recursive: true, preserveTimestamps: true })
  return target
}
try {
  const clean = copyOf("clean")
  legs.control_clean = closure(clean)

  // One byte-mutation leg and one deletion leg PER GROUP (agent-references first) — that is what
  // separates the BYTE rule from the PRESENCE rule on the tree the acceptance names.
  const groups = chosen.perGroup.length > 0 ? chosen.perGroup : chosen.candidates.map((c) => ({ rel: c.rel, sourceMtime: c.sourceMtime }))
  for (const candidate of groups) {
    const label = candidate.rel.split("/")[0]
    const byteCopy = copyOf("mutated-bytes-" + label)
    const targetPath = join(byteCopy, candidate.rel)
    writeFileSync(targetPath, Buffer.concat([readFileSync(targetPath), Buffer.from("\n<!-- t13 review: one byte-class mutation on the PACKED side -->\n")]))
    legs["mutation_bytes_" + label] = { target: candidate.rel, targetSourceMtime: candidate.sourceMtime, ...closure(byteCopy) }

    const deleteCopy = copyOf("deleted-" + label)
    rmSync(join(deleteCopy, candidate.rel), { recursive: true, force: true })
    legs["mutation_deleted_" + label] = { target: candidate.rel, ...closure(deleteCopy) }
  }

  const rootCopy = copyOf("mutated-root")
  const rootPath = join(rootCopy, ROOT_FILE)
  writeFileSync(rootPath, readFileSync(rootPath, "utf8") + "\n<!-- t13 review: the ONE root file, PACKED-side mutation -->\n")
  legs.mutation_root_file = { target: ROOT_FILE, ...closure(rootCopy) }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
const after = stamp()

const newFindings = (leg) => leg.findings.filter((line) => !legs.control_clean.findings.includes(line))
const names = (lines, needle) => lines.filter((line) => line.includes(needle)).length

const report = {
  schema: "review-B/t13-falsification/2",
  captured_at: new Date().toISOString(),
  method_note: "differential + PINNED STAMP: every leg runs with --pack-stamp set to the canonical artifact's own inferred moment, so the only difference between the clean control and a mutated copy is the mutation. Two superseded methods are recorded: (v0) pinning the stamp to NOW reddened the clean control for a valid reason (all real post-pack writers became hard drifts); (v1) letting the copy infer its own stamp meant the mutation itself moved the stamp forward and reclassified the honest drifts — falsification.v1.json keeps that pass.",
  pinned_stamp: PINNED_STAMP,
  question: "was any moved rule made green by weakening it?",
  repo_head: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  gate_script_sha256: sha("scripts/verify-pack-closure.mjs"),
  artifact_read_only: { before, after, identical: before.digest === after.digest && before.files === after.files },
  control: {
    candidates_unchanged_since_pack: chosen.candidates,
    artifact_newest_mtime: chosen.artifactNewest,
    control_exit: legs.control_clean.exitCode,
    control_content_bytes: legs.control_clean.contentBytes,
    control_completeness: legs.control_clean.completeness,
  },
  legs: Object.fromEntries(Object.entries(legs).filter(([k]) => k !== "control_clean").map(([k, leg]) => [k, {
    target: leg.target,
    exitCode: leg.exitCode,
    hard_findings_naming_target: names(leg.hardFindings, leg.target),
    expected_findings_naming_target: names(leg.expectedFindings, leg.target),
    new_findings_vs_control: newFindings(leg).slice(0, 4),
  }])),
  verdict: {
    clean_control_green: legs.control_clean.exitCode === 0,
    packed_byte_mutation_reddens_and_is_NAMED: Object.entries(legs).filter(([k]) => k.startsWith("mutation_bytes")).every(([, leg]) => leg.exitCode !== 0 && names(leg.hardFindings, leg.target) > 0),
    packed_file_deletion_detected: Object.entries(legs).filter(([k]) => k.startsWith("mutation_deleted")).every(([, leg]) => leg.exitCode !== 0),
    per_group_legs: Object.keys(legs).filter((k) => k.startsWith("mutation_bytes_")).length,
    // The root-file leg is REPORTED either way: exit 0 + an EXPECTED finding means the mutation was
    // named but not hardened, which is lane B's own documented bound (REPORT.md §5 bound 1: the EXPECTED
    // class is a timestamp-order discriminator, so a file whose source is also a post-pack writer cannot be
    // told apart from an honest late write). Recording the class, not a pass/fail, is the honest shape.
    root_file_packed_mutation_class: names(legs.mutation_root_file.expectedFindings, ROOT_FILE) > 0
      ? "REPORTED in the EXPECTED class (exit 0; lane B's REPORT.md §5 bound 1 predicts exactly this)"
      : (names(legs.mutation_root_file.hardFindings, ROOT_FILE) > 0 ? "HARD (exit " + legs.mutation_root_file.exitCode + ")" : "NOT REPORTED — a finding"),
  },
}
writeFileSync(join(dir, "falsification.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 2).slice(0, 2500))
