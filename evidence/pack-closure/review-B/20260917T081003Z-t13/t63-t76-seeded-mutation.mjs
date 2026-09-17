#!/usr/bin/env node
// T-63 / T-76 evidence on the REAL artifact: a byte-copy of `dist/mpd-package` with ONE byte changed
// inside a shipped file must be caught by the BYTE rule while every PRESENCE assertion stays
// satisfied. The canonical artifact is only ever READ from here (it is only ever a cpSync SOURCE) -
// the wave's one-writer-at-a-time rule.
//
// Two mutation targets, chosen by MEASUREMENT rather than by hand, because the expected/hard split is a
// property of the writer's timestamp:
//   * a declared source file whose mtime PREDATES the artifact stamp -> the mutation must be a hard
//     CONTENT-DRIFT and the gate must exit 1 (a byte changed inside a declared artifact);
//   * a declared source file whose mtime is AFTER the artifact stamp (a post-pack writer) -> the same
//     mutation is the provenance-named EXPECTED class (exit 0), and pinning the stamp at that writer's
//     own mtime flips it to a hard CONTENT-DRIFT. That pair is what proves the classification reads the
//     stamped time and is not simply "anything goes".
//
// usage: node t63-t76-seeded-mutation.mjs      (run from the repository root)
// exit 0 = every reading behaved as specified; exit 1 = at least one did not.
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

const repo = process.cwd()
const GATE = join(repo, "scripts", "verify-pack-closure.mjs")
const PACKED = join(repo, "dist", "mpd-package")

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name)
    if (entry.isDirectory()) walk(child, out)
    else if (entry.isFile()) out.push(child)
  }
  return out
}

const gate = (args) => {
  try {
    const out = execFileSync(process.execPath, [GATE, ...args], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 })
    return { exitCode: 0, output: out }
  } catch (error) {
    return { exitCode: error.status ?? -1, output: String(error.stdout ?? "") + String(error.stderr ?? "") }
  }
}

const artifactStampMs = () => Math.max(...walk(PACKED).map((f) => statSync(f).mtimeMs))

const scratch = mkdtempSync(join(tmpdir(), "mpd-laneB-mutation-"))
const copy = join(scratch, "artifact-copy")
const report = { schema: "laneB/t63-t76-seeded-mutation/1", captured_at: new Date().toISOString(), canonical_artifact: PACKED, readings: [], ok: false }
try {
  const stampMs = artifactStampMs()
  report.artifact_stamp = { ms: stampMs, iso: new Date(stampMs).toISOString(), anchor: "inferred: the newest mtime among the artifact's own files" }
  cpSync(PACKED, copy, { recursive: true, preserveTimestamps: true })

  const candidates = []
  for (const dir of ["docs", "templates", "extensions", "presets", "skills", "agent-references"]) {
    for (const abs of walk(join(repo, dir))) candidates.push(relative(repo, abs))
  }
  for (const pkg of readdirSync(join(repo, "packages"))) {
    for (const abs of walk(join(repo, "packages", pkg, "dist"))) candidates.push(relative(repo, abs))
  }
  const usable = candidates.filter((rel) => existsSync(join(copy, rel)) && statSync(join(repo, rel)).mtimeMs <= stampMs)
  const postPack = candidates.filter((rel) => existsSync(join(copy, rel)) && statSync(join(repo, rel)).mtimeMs > stampMs)
  if (usable.length === 0 || postPack.length === 0) {
    report.selection_failure = { usable: usable.length, post_pack: postPack.length, note: "the tree no longer offers one file of each class; the readings below cannot be composed" }
    console.log(JSON.stringify(report, null, 2))
    process.exit(1)
  }
  const prePackTarget = usable[0]
  const postPackTarget = postPack.includes("agent-references/troubleshooting.md") ? "agent-references/troubleshooting.md" : postPack[0]
  report.candidate_counts = { pre_pack_class: usable.length, post_pack_class: postPack.length }
  report.targets = {
    pre_pack: { path: prePackTarget, source_mtime: new Date(statSync(join(repo, prePackTarget)).mtimeMs).toISOString(), why: "source mtime PREDATES the artifact stamp -> a mutation here must be a hard CONTENT-DRIFT" },
    post_pack: { path: postPackTarget, source_mtime: new Date(statSync(join(repo, postPackTarget)).mtimeMs).toISOString(), why: "source mtime is AFTER the artifact stamp (a post-pack writer) -> the same mutation is the provenance-named EXPECTED class" },
  }

  const clean = gate(["--packed", copy, "--require-packed"])
  report.readings.push({ arm: "byte-copy of the real artifact, untouched", exitCode: clean.exitCode, expected: 0, tail: clean.output.trim().split("\n").filter((l) => l.includes("content bytes:")).slice(0, 1) })

  const mutate = (rel) => {
    const target = join(copy, rel)
    const mtime = statSync(target).mtime
    const before = readFileSync(target)
    const after = Buffer.from(before)
    after[0] = after[0] === 0x23 ? 0x20 : 0x23
    writeFileSync(target, after)
    utimesSync(target, mtime, mtime)
    return { first_byte_before: before[0], first_byte_after: after[0], bytes: { before: before.length, after: after.length } }
  }

  const preMutation = mutate(prePackTarget)
  const preRun = gate(["--packed", copy, "--require-packed"])
  report.readings.push({
    arm: "one byte changed in a PRE-pack-mtime file",
    path: prePackTarget,
    mutation: preMutation,
    exitCode: preRun.exitCode,
    expected: 1,
    hard_content_drift_names_the_file: preRun.output.includes("CONTENT-DRIFT - " + prePackTarget),
    presence_assertions_still_green: !/REFERENCES/.test(preRun.output),
    tail: preRun.output.trim().split("\n").filter((l) => l.includes(prePackTarget)).slice(0, 2),
  })
  const target = join(copy, prePackTarget)
  const body = readFileSync(target)
  body[0] = preMutation.first_byte_before
  writeFileSync(target, body)
  const sourceMtime = statSync(join(repo, prePackTarget)).mtime
  utimesSync(target, sourceMtime, sourceMtime)

  const postMutation = mutate(postPackTarget)
  const postRun = gate(["--packed", copy, "--require-packed"])
  report.readings.push({
    arm: "one byte changed in a POST-pack-mtime file",
    path: postPackTarget,
    mutation: postMutation,
    exitCode: postRun.exitCode,
    expected: 0,
    reported_as_expected_not_silent: postRun.output.includes("CONTENT-DRIFT-EXPECTED") && postRun.output.includes(postPackTarget),
    tail: postRun.output.trim().split("\n").filter((l) => l.includes(postPackTarget)).slice(0, 1),
  })
  // Pin at THAT writer's mtime (not the other target's): the source can no longer be "after the pack".
  const postSourceMtime = statSync(join(repo, postPackTarget)).mtime
  const pinnedRun = gate(["--packed", copy, "--require-packed", "--pack-stamp", postSourceMtime.toISOString()])
  report.readings.push({
    arm: "same post-pack mutation, stamp pinned at that writer's own mtime",
    path: postPackTarget,
    exitCode: pinnedRun.exitCode,
    expected: 1,
    hard_content_drift_names_the_file: pinnedRun.output.includes("CONTENT-DRIFT - " + postPackTarget),
    tail: pinnedRun.output.trim().split("\n").filter((l) => l.includes(postPackTarget)).slice(0, 1),
  })

  const [cleanRun, pre, post, pinned] = report.readings
  report.ok =
    cleanRun.exitCode === 0 &&
    pre.exitCode === 1 &&
    pre.hard_content_drift_names_the_file === true &&
    pre.presence_assertions_still_green === true &&
    post.exitCode === 0 &&
    post.reported_as_expected_not_silent === true &&
    pinned.exitCode === 1 &&
    pinned.hard_content_drift_names_the_file === true
  report.verdict = report.ok ? "ALL READINGS BEHAVED AS SPECIFIED" : "AT LEAST ONE READING DID NOT BEHAVE AS SPECIFIED"
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
console.log(JSON.stringify(report, null, 2))
process.exit(report.ok ? 0 : 1)
