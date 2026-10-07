#!/usr/bin/env node
// T-63 evidence for the captain's PACKER ROUTE ruling: `scripts/pack-mpd.mjs --out <dir>` must be
// BACKWARD COMPATIBLE. Three readings, each measured:
//   1. the default invocation (`node (copy)/scripts/pack-mpd.mjs`, NO flags) stages into the copy's own
//      `<repo>/dist/mpd-package` — and its output is BYTE-IDENTICAL to the `--out <dir>` output of the
//      same sources, which is what makes the flag a pure redirection;
//   2. the canonical artifact `dist/mpd-package` is NEVER written (its stamp is read before/after), and
//      the divergence between a fresh pack and the canonical artifact is EXACTLY the set of source files
//      whose mtime is after the artifact's stamp (the wave's post-pack writers) — no unexplained byte;
//   3. the flag's own guards: `--out` with no value and `--out <repo root>` are refused.
// usage: node t63-out-flag-equivalence.mjs     (run from the repository root)
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const repo = process.cwd()
const PACKED = join(repo, "dist", "mpd-package")
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")
const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name)
    if (entry.isDirectory()) walk(child, out)
    else if (entry.isFile()) out.push(child)
  }
  return out
}
const stampOf = (dir) => {
  const files = walk(dir)
  const newest = Math.max(0, ...files.map((f) => statSync(f).mtimeMs))
  return { files: files.length, newestMs: newest, iso: new Date(newest).toISOString() }
}
const run = (args, cwd) => {
  try {
    return { exitCode: 0, output: execFileSync(process.execPath, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }) }
  } catch (error) {
    return { exitCode: error.status ?? -1, output: String(error.stdout ?? "") + String(error.stderr ?? "") }
  }
}

const scratchParent = join(repo, ".mpd", "laneB-outflag")
rmSync(scratchParent, { recursive: true, force: true })
mkdirSync(scratchParent, { recursive: true })
const report = { schema: "laneB/t63-out-flag-equivalence/1", captured_at: new Date().toISOString(), readings: [], ok: false }
try {
  // 1. a hardlink copy of the repo (same filesystem: `.mpd/` is inside the workspace), so the DEFAULT
  //    invocation can be exercised without ever aiming the packer at the real `dist/mpd-package`.
  const copy = join(scratchParent, "repo-copy")
  mkdirSync(copy, { recursive: true })
  for (const item of ["scripts", "packages", "skills", "presets", "extensions", "templates", "docs", "agent-references", "package.json", "LICENSE.md", "LICENSE-NOTICES.md", "README.md", "README.zh-CN.md", "EXTENSIONS-FOR-AGENTS.md", "tsconfig.json", "VENDOR_LOCK.json"]) {
    const src = join(repo, item)
    if (!existsSync(src)) continue
    execFileSync("cp", ["-al", src, join(copy, item)], { stdio: ["ignore", "ignore", "inherit"] })
  }
  const outFlagDir = join(scratchParent, "pack-out-flag")
  const canonicalBefore = stampOf(PACKED)
  const defaultRun = run([join(copy, "scripts", "pack-mpd.mjs")], repo)
  const flagRun = run([join(repo, "scripts", "pack-mpd.mjs"), "--out", outFlagDir], repo)
  const canonicalAfter = stampOf(PACKED)
  report.readings.push({
    arm: "default invocation (no flags) vs --out",
    default_run: { exitCode: defaultRun.exitCode, staged: join(copy, "dist", "mpd-package"), banner: defaultRun.output.trim().split("\n").filter((l) => l.includes("staged package")).join(" ") },
    out_flag_run: { exitCode: flagRun.exitCode, staged: outFlagDir, banner: flagRun.output.trim().split("\n").filter((l) => l.includes("staged package")).join(" ") },
  })
  report.readings.push({ arm: "the canonical artifact is never written", before: canonicalBefore, after: canonicalAfter, identical: canonicalBefore.iso === canonicalAfter.iso && canonicalBefore.files === canonicalAfter.files })
  if (defaultRun.exitCode !== 0 || flagRun.exitCode !== 0) {
    report.failure = "a pack run failed; byte comparison cannot be composed"
  } else {
    const defaultPack = join(copy, "dist", "mpd-package")
    // 2. the two packs of the SAME sources must be byte-identical (the flag is a pure redirection)
    const defaultFiles = walk(defaultPack).map((f) => relative(defaultPack, f)).sort()
    const flagFiles = walk(outFlagDir).map((f) => relative(outFlagDir, f)).sort()
    const setEqual = JSON.stringify(defaultFiles) === JSON.stringify(flagFiles)
    const differing = setEqual ? defaultFiles.filter((rel) => sha(join(defaultPack, rel)) !== sha(join(outFlagDir, rel))) : null
    report.readings.push({ arm: "default-path pack vs --out pack (same sources)", files: defaultFiles.length, set_equal: setEqual, differing_files: differing === null ? null : differing.slice(0, 10), differing_count: differing === null ? null : differing.length })
    // 3. divergence of a FRESH pack from the canonical artifact: every entry must be a source file whose
    //    mtime is after the artifact's stamp (a post-pack writer), never an unexplained byte.
    const canonicalFiles = walk(PACKED).map((f) => relative(PACKED, f)).sort()
    const onlyCanonical = canonicalFiles.filter((rel) => !flagFiles.includes(rel))
    const onlyFresh = flagFiles.filter((rel) => !canonicalFiles.includes(rel))
    const changed = flagFiles.filter((rel) => canonicalFiles.includes(rel) && sha(join(outFlagDir, rel)) !== sha(join(PACKED, rel)))
    const unexplained = changed.filter((rel) => {
      const src = join(repo, rel)
      return !existsSync(src) || statSync(src).mtimeMs <= canonicalBefore.newestMs
    })
    report.readings.push({
      arm: "fresh pack vs the canonical artifact",
      changed_count: changed.length,
      changed_sample: changed.slice(0, 14),
      only_in_canonical: onlyCanonical,
      only_in_fresh: onlyFresh,
      unexplained_by_a_post_pack_writer: unexplained,
    })
    const canonicalReading = report.readings.find((r) => r.arm === "the canonical artifact is never written")
    report.ok = canonicalReading.identical === true && setEqual === true && (differing?.length ?? 1) === 0 && onlyCanonical.length === 0 && unexplained.length === 0
  }
  // 4. the flag's own guards
  const noValue = run([join(repo, "scripts", "pack-mpd.mjs"), "--out"], repo)
  const overRoot = run([join(repo, "scripts", "pack-mpd.mjs"), "--out", "."], repo)
  report.readings.push({
    arm: "flag guards",
    missing_value: { exitCode: noValue.exitCode, refused: noValue.exitCode === 2 && /--out needs a directory/.test(noValue.output) },
    repo_root_value: { exitCode: overRoot.exitCode, refused: overRoot.exitCode === 2 && /refusing to stage a pack over the repository root/.test(overRoot.output) },
  })
  const guards = report.readings.find((r) => r.arm === "flag guards")
  report.ok = report.ok === true && guards !== undefined && guards.missing_value.refused === true && guards.repo_root_value.refused === true
  report.verdict = report.ok ? "ALL READINGS BEHAVED AS SPECIFIED" : "AT LEAST ONE READING DID NOT BEHAVE AS SPECIFIED"
} finally {
  rmSync(scratchParent, { recursive: true, force: true })
}
console.log(JSON.stringify(report, null, 2))
process.exit(report.ok ? 0 : 1)
